package io.github.guhilling.todo.service;

import io.github.guhilling.todo.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.instanceOf;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Pins down the create-on-first-sight rule that gives every authenticated email a user row.
 *
 * <p>The two lookups run in separate transactions on purpose: reusing an existing user has
 * to work across requests, not merely within one persistence context, since that is how it
 * will be called in production.</p>
 */
@QuarkusTest
class UserServiceTest {

    private static final int CONCURRENT_CALLERS = 8;

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

    @Test
    void shouldPropagateAFailureThatIsNotALostRace() {
        // Losing the race is the only failure getOrCreateByEmail is allowed to swallow. A null
        // email violates the not-blank rule instead, and has to surface as itself -- if it were
        // absorbed, the caller would be told the user "vanished", which names neither the cause
        // nor the culprit.
        RuntimeException failure = assertThrows(
            RuntimeException.class,
            () -> QuarkusTransaction.requiringNew().call(() -> userService.getOrCreateByEmail(null)));

        assertThat(rootCauseOf(failure), not(instanceOf(IllegalStateException.class)));
    }

    private static Throwable rootCauseOf(Throwable failure) {
        Throwable cause = failure;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause;
    }

    @Test
    void shouldCreateOnlyOneUserWhenRequestsForTheSameNewEmailOverlap() throws Exception {
        String email = "concurrent-" + UUID.randomUUID() + "@example.com";
        int callers = CONCURRENT_CALLERS;

        // A barrier makes every caller reach the lookup at the same moment, which is what turns
        // the check-then-act in getOrCreateByEmail into an actual collision rather than a
        // theoretical one. The browser produces the same overlap on a first sign-in.
        CyclicBarrier startTogether = new CyclicBarrier(callers);
        ExecutorService executor = Executors.newFixedThreadPool(callers);
        try {
            List<Future<Long>> results = new ArrayList<>();
            for (int caller = 0; caller < callers; caller++) {
                results.add(executor.submit((Callable<Long>) () -> {
                    startTogether.await();
                    return QuarkusTransaction.requiringNew().call(() -> userService.getOrCreateByEmail(email).id);
                }));
            }

            Long firstId = results.getFirst().get();
            assertThat(firstId, notNullValue());
            for (Future<Long> result : results) {
                assertThat(result.get(), equalTo(firstId));
            }
        } finally {
            executor.shutdownNow();
        }

        assertThat(QuarkusTransaction.requiringNew().call(() -> User.count("email", email)), equalTo(1L));
    }
}
