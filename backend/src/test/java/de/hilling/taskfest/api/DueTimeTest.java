package de.hilling.taskfest.api;

import de.hilling.taskfest.model.TaskImportance;
import de.hilling.taskfest.model.TaskState;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.oidc.Claim;
import io.quarkus.test.security.oidc.OidcSecurity;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Covers a task's due time and its zone on the wire and in the database (#474): an all-day task, a
 * floating time and a zoned one through create, update and read, the moment a zoned task is due
 * at, and the refusals.
 *
 * <p>Identity is faked by {@code @TestSecurity}, as in {@link TaskResourceTest}. Which values the
 * rules let through is {@link DueTimeRulesTest}'s, and the daylight-saving arithmetic is
 * {@code TaskDueAtTest}'s; here it is what a client sends and reads back, and that the database
 * holds the zone-only-with-a-time rule on its own.</p>
 */
@QuarkusTest
class DueTimeTest {

    private static final String ALICE = "alice@example.com";
    private static final String BERLIN = "Europe/Berlin";

    @Inject
    DataSource dataSource;

    /** A task due on 30 November 2099, all day unless a time or zone is put in. */
    private static Map<String, Object> task(String description) {
        Map<String, Object> body = new HashMap<>();
        body.put("description", description);
        body.put("dueDate", "2099-11-30");
        body.put("importance", TaskImportance.MEDIUM.name());
        body.put("state", TaskState.TODO.name());
        return body;
    }

    private static Map<String, Object> at(String description, String time, String zone) {
        Map<String, Object> body = task(description);
        body.put("dueTime", time);
        body.put("timeZone", zone);
        return body;
    }

    private static int created(Map<String, Object> body) {
        return given()
            .contentType(ContentType.JSON)
            .body(body)
            .when().post("/api/tasks")
            .then()
            .statusCode(201)
            .extract().path("id");
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldKeepATaskWithoutATimeAllDay() {
        int id = created(task("All day " + UUID.randomUUID()));

        given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("find { it.id == " + id + " }.dueDate", equalTo("2099-11-30"))
            .body("find { it.id == " + id + " }.dueTime", nullValue())
            .body("find { it.id == " + id + " }.timeZone", nullValue())
            .body("find { it.id == " + id + " }.dueAt", nullValue());
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldKeepAFloatingTimeWithoutAMoment() {
        int id = created(at("Take the pills " + UUID.randomUUID(), "08:00", null));

        given()
            .when().get("/api/tasks")
            .then()
            .statusCode(200)
            .body("find { it.id == " + id + " }.dueTime", equalTo("08:00"))
            .body("find { it.id == " + id + " }.timeZone", nullValue())
            .body("find { it.id == " + id + " }.dueAt", nullValue());
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldAnswerAZonedTimeWithItsMoment() {
        given()
            .contentType(ContentType.JSON)
            .body(at("Meeting in Berlin " + UUID.randomUUID(), "10:00", BERLIN))
            .when().post("/api/tasks")
            .then()
            .statusCode(201)
            .body("dueDate", equalTo("2099-11-30"))
            .body("dueTime", equalTo("10:00"))
            .body("timeZone", equalTo(BERLIN))
            .body("dueAt", equalTo("2099-11-30T09:00:00Z"));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldMoveAZonedTimeInADaylightSavingGapLater() {
        Map<String, Object> body = at("In the gap " + UUID.randomUUID(), "02:30", BERLIN);
        body.put("dueDate", "2099-03-29");

        given()
            .contentType(ContentType.JSON)
            .body(body)
            .when().post("/api/tasks")
            .then()
            .statusCode(201)
            .body("dueTime", equalTo("02:30"))
            .body("dueAt", equalTo("2099-03-29T01:30:00Z"));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldTakeTheEarlierMomentOfAZonedTimeInAnOverlap() {
        Map<String, Object> body = at("In the overlap " + UUID.randomUUID(), "02:30", BERLIN);
        body.put("dueDate", "2099-10-25");

        given()
            .contentType(ContentType.JSON)
            .body(body)
            .when().post("/api/tasks")
            .then()
            .statusCode(201)
            .body("dueAt", equalTo("2099-10-25T00:30:00Z"));
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldChangeAndClearATimeOnUpdate() {
        String description = "Moved around " + UUID.randomUUID();
        int id = created(at(description, "08:00", null));

        given()
            .contentType(ContentType.JSON)
            .body(at(description, "16:45", "America/New_York"))
            .when().put("/api/tasks/{id}", id)
            .then()
            .statusCode(200)
            .body("dueTime", equalTo("16:45"))
            .body("timeZone", equalTo("America/New_York"))
            .body("dueAt", equalTo("2099-11-30T21:45:00Z"));

        // An update replaces the whole task, so one without a time makes it all day again.
        given()
            .contentType(ContentType.JSON)
            .body(task(description))
            .when().put("/api/tasks/{id}", id)
            .then()
            .statusCode(200)
            .body("dueTime", nullValue())
            .body("timeZone", nullValue())
            .body("dueAt", nullValue());
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldRefuseAZoneWithoutATime() {
        given()
            .contentType(ContentType.JSON)
            .body(at("Zone only " + UUID.randomUUID(), null, BERLIN))
            .when().post("/api/tasks")
            .then()
            .statusCode(400);

        int id = created(task("Zone only later " + UUID.randomUUID()));
        given()
            .contentType(ContentType.JSON)
            .body(at("Zone only later", null, BERLIN))
            .when().put("/api/tasks/{id}", id)
            .then()
            .statusCode(400);
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldRefuseAZoneTheJvmDoesNotKnow() {
        given()
            .contentType(ContentType.JSON)
            .body(at("Atlantis " + UUID.randomUUID(), "10:00", "Europe/Atlantis"))
            .when().post("/api/tasks")
            .then()
            .statusCode(400);
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldRefuseATimeFinerThanMinutes() {
        given()
            .contentType(ContentType.JSON)
            .body(at("To the second " + UUID.randomUUID(), "10:00:30", null))
            .when().post("/api/tasks")
            .then()
            .statusCode(400);
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldRefuseATimeGivenOtherThanAsText() {
        // Jackson reads [10, 0, 30] as a LocalTime too, seconds and all, whatever the format says.
        Map<String, Object> body = task("As an array " + UUID.randomUUID());
        body.put("dueTime", java.util.List.of(10, 0, 30));
        given()
            .contentType(ContentType.JSON)
            .body(body)
            .when().post("/api/tasks")
            .then()
            .statusCode(400);
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldRefuseTwentyFourOClock() {
        // A lenient parser takes it as the next day's midnight, and LocalTime drops the day.
        given()
            .contentType(ContentType.JSON)
            .body(at("Midnight " + UUID.randomUUID(), "24:00", BERLIN))
            .when().post("/api/tasks")
            .then()
            .statusCode(400);
    }

    @Test
    @TestSecurity(user = ALICE)
    @OidcSecurity(claims = { @Claim(key = "email", value = ALICE) })
    void shouldHaveTheDatabaseRefuseAZoneWithoutATime() throws SQLException {
        int id = created(task("Written around the API " + UUID.randomUUID()));

        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                 "update task set time_zone = 'Europe/Berlin', due_time = null where id = ?")) {
            statement.setLong(1, id);
            SQLException refused = assertThrows(SQLException.class, statement::executeUpdate);
            assertThat(refused.getMessage(), containsString("task_zone_only_with_time"));
        }
    }
}
