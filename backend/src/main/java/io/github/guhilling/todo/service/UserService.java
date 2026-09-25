package io.github.guhilling.todo.service;

import io.github.guhilling.todo.model.User;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import org.hibernate.exception.ConstraintViolationException;

/**
 * The single door through which {@link User} records come into existence.
 *
 * <p>Because identity arrives from an external provider rather than from a sign-up form,
 * "look up this user, and create them if this is their first visit" is the only user
 * operation the application needs. Keeping it here rather than inline in the resources
 * means the create-on-first-request rule is stated once, and that the transaction boundary
 * around it sits in one place.</p>
 *
 * <p>That rule is a check-then-act, so two requests arriving together for an email nobody
 * has seen before will both try to create it. The unique constraint on the email column is
 * what actually decides the winner; this class is responsible for making the loser behave
 * as though it had simply found the user already there.</p>
 */
@ApplicationScoped
public class UserService {

    @Transactional
    public User getOrCreateByEmail(String email) {
        User existing = findByEmail(email);
        if (existing != null) {
            return existing;
        }

        insertIgnoringLostRace(email);

        User created = findByEmail(email);
        if (created == null) {
            throw new IllegalStateException("User " + email + " vanished immediately after being created.");
        }
        return created;
    }

    private static User findByEmail(String email) {
        return User.find("email", email).firstResult();
    }

    /**
     * Inserts the user, treating a duplicate-email collision as success.
     *
     * <p>The insert deliberately runs in its own transaction. A constraint violation dooms
     * the transaction it happens in, so letting it happen in the caller's transaction would
     * poison an entire request -- and the caller is usually
     * {@code TaskResource.create}, which is itself transactional. Isolating the insert
     * means the loser of a race gives up nothing but the insert.</p>
     *
     * <p>Any constraint violation here is necessarily the unique email: this transaction
     * inserts exactly one row, and its only other constraint is the non-null email that the
     * caller has just supplied.</p>
     *
     * <p>Losing the race is normal and harmless, but Hibernate still logs the rejected
     * statement at WARN ({@code HHH000247}, {@code SQLState: 23505}). A pair of those lines
     * with no accompanying error is this method working, not failing.</p>
     */
    private static void insertIgnoringLostRace(String email) {
        try {
            QuarkusTransaction.requiringNew().run(() -> {
                User user = new User();
                user.email = email;
                user.persist();
                // Flush inside the transaction so a collision surfaces here, where it can be
                // recognised, rather than out of the commit as a wrapped failure.
                user.flush();
            });
        } catch (RuntimeException failure) {
            if (!isDuplicateEmail(failure)) {
                throw failure;
            }
        }
    }

    private static boolean isDuplicateEmail(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException) {
                return true;
            }
        }
        return false;
    }
}
