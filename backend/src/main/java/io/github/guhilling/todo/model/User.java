package io.github.guhilling.todo.model;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;

/**
 * Someone who owns tasks, identified solely by the email claim from their OIDC token.
 *
 * <p>There is no registration step and no password: a user row appears the first time an
 * authenticated request arrives with an email this application has not seen before. The
 * email is therefore both the natural key and the join between the identity provider's
 * world and this one, which is why it is unique and not-null rather than merely a profile
 * attribute.</p>
 */
@Entity
@Table(name = "app_user")
public class User extends PanacheEntityBase {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @NotBlank
    @Column(nullable = false, unique = true)
    public String email;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
