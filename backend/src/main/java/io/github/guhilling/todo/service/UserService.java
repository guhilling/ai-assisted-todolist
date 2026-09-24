package io.github.guhilling.todo.service;

import io.github.guhilling.todo.model.User;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;

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
