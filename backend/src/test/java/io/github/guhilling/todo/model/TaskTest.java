package io.github.guhilling.todo.model;

import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Covers the two things about a task that only a real persistence context can show:
 * that the description length constraint is enforced, and that the audit timestamps are
 * populated and maintained by Hibernate.
 *
 * <p>It runs against the PostgreSQL that Dev Services starts rather than an in-memory
 * database, because timestamp generation and column constraints are exactly the behaviour
 * that differs between engines.</p>
 */
@QuarkusTest
class TaskTest {

    @Inject
    Validator validator;

    @Test
    void shouldRejectDescriptionOver255Chars() {
        Task task = new Task();
        task.description = "x".repeat(256);
        task.dueDate = LocalDate.now().plusDays(1);
        task.importance = TaskImportance.MEDIUM;
        task.state = TaskState.TODO;

        Set<ConstraintViolation<Task>> violations = validator.validate(task);

        assertTrue(violations.stream()
            .anyMatch(violation -> violation.getPropertyPath().toString().equals("description")));
    }

    @Test
    void shouldPersistImportanceAndManageTimestamps() {
        QuarkusTransaction.requiringNew().run(() -> {
            User owner = new User();
            owner.email = "owner-" + UUID.randomUUID() + "@example.com";
            owner.persist();

            Task task = new Task();
            task.description = "Write the report";
            task.dueDate = LocalDate.now().plusDays(3);
            task.importance = TaskImportance.HIGH;
            task.state = TaskState.TODO;
            task.owner = owner;
            task.persist();
            task.flush();

            assertThat(task.importance, equalTo(TaskImportance.HIGH));
            assertThat(task.createdAt, notNullValue());
            assertThat(task.updatedAt, notNullValue());

            var createdAt = task.createdAt;
            task.state = TaskState.WORKING;
            task.flush();

            assertThat(task.updatedAt.compareTo(createdAt), greaterThanOrEqualTo(0));
        });
    }
}
