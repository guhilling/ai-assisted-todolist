package io.github.guhilling.todo.service;

import io.github.guhilling.todo.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

/**
 * Pins down the create-on-first-sight rule that gives every authenticated email a user row.
 *
 * <p>The two lookups run in separate transactions on purpose: reusing an existing user has
 * to work across requests, not merely within one persistence context, since that is how it
 * will be called in production.</p>
 */
@QuarkusTest
class UserServiceTest {

    @Inject
    UserService userService;

    @Test
    void shouldCreateUserOnFirstLookupAndReuseOnSecond() {
        String email = "user-" + UUID.randomUUID() + "@example.com";

        User first = QuarkusTransaction.requiringNew().call(() -> userService.getOrCreateByEmail(email));
        User second = QuarkusTransaction.requiringNew().call(() -> userService.getOrCreateByEmail(email));

        assertThat(first.id, notNullValue());
        assertThat(second.id, equalTo(first.id));
    }
}
