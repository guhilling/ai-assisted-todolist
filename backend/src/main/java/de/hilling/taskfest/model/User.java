package de.hilling.taskfest.model;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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

    /**
     * The longest address RFC 5321 allows: a 64-character local part, an at sign, and a domain
     * of up to 255. The column is VARCHAR(255) and so accepts one more, deliberately -- the
     * database is the looser bound, and validation is what decides.
     */
    public static final int MAX_EMAIL_LENGTH = 254;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @NotBlank
    @Email
    @Size(max = MAX_EMAIL_LENGTH)
    @Column(nullable = false, unique = true)
    public String email;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
