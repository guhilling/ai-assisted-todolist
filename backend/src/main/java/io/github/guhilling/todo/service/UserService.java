package io.github.guhilling.todo.service;

import io.github.guhilling.todo.model.User;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;

/**
 * The single door through which {@link User} records come into existence.
 *
 * <p>Because identity arrives from an external provider rather than from a sign-up form,
 * "look up this user, and create them if this is their first visit" is the only user
 * operation the application needs. Keeping it here rather than inline in the resources
 * means the create-on-first-request rule is stated once, and that the transaction boundary
 * around it sits in one place.</p>
 */
@ApplicationScoped
public class UserService {

    @Transactional
    public User getOrCreateByEmail(String email) {
        User existing = User.find("email", email).firstResult();
        if (existing != null) {
            return existing;
        }
        User user = new User();
        user.email = email;
        user.persist();
        return user;
    }
}
