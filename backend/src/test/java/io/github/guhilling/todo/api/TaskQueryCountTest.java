package io.github.guhilling.todo.api;

import io.github.guhilling.todo.model.TaskImportance;
import io.github.guhilling.todo.model.TaskState;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManagerFactory;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.lessThanOrEqualTo;

/**
 * Holds the board's list endpoint to a fixed number of database round trips.
 *
 * <p>The rule is that a GET runs a constant number of statements: a couple is fine, but the
 * count must not grow with the number of rows returned. That is the shape of an N+1, and it is
 * invisible in development, where everyone has three tasks, and expensive in a database with a
 * real one. Nothing else here would notice it -- the responses stay correct, the tests stay
 * green, and only the statement count moves.</p>
 *
 * <p>It is measured rather than reasoned about because the thing that causes it is usually a
 * change somewhere else: a lazy association touched while mapping a response, a fetch mode
 * altered, a field added to {@code TaskResponse}. The count is what notices.</p>
 *
 * <p>What it cannot catch, stated so the guarantee is not overread: {@code Task.owner} will not
 * produce an N+1 however it is fetched, because every task in one response belongs to the same
 * user and that user is already in the persistence context from resolving the caller. Touching
 * it per row costs nothing. The test was checked against genuine per-row work instead, which
 * took the count from three to twelve and failed both assertions.</p>
 */
@QuarkusTest
class TaskQueryCountTest {

    private static final String ALICE = "alice@example.com";

    /** The issue's own limit: one statement is the aim, two or three acceptable. */
    private static final long ACCEPTABLE_STATEMENTS = 3;

    @Inject
    EntityManagerFactory entityManagerFactory;

    private Statistics statistics() {
        return entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
    }

    /** Runs the list endpoint and reports how many JDBC statements it took. */
    private long statementsToListTasks() {
        Statistics statistics = statistics();
        statistics.clear();
        given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200);
        return statistics.getPrepareStatementCount();
    }

    private static void createTask(String description) {
        given()
            .contentType(ContentType.JSON)
            .body(Map.of(
                "description", description,
                "dueDate", LocalDate.now().plusDays(3).toString(),
                "importance", TaskImportance.LOW.name(),
                "state", TaskState.TODO.name()))
            .when().post("/api/tasks")
            .then()
            .statusCode(201);
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldNotRunMoreQueriesAsTasksAreAdded() {
        String marker = "counting-" + UUID.randomUUID();
        createTask(marker + " one");
        long withOneMore = statementsToListTasks();

        for (int i = 0; i < 9; i++) {
            createTask(marker + " extra " + i);
        }
        long withTenMore = statementsToListTasks();

        assertThat(withTenMore, equalTo(withOneMore));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldListTasksInAFewStatements() {
        // Two, as it stands: one to resolve the caller from the email claim, one for the tasks.
        assertThat(statementsToListTasks(), lessThanOrEqualTo(ACCEPTABLE_STATEMENTS));
    }
}
