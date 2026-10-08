package de.hilling.taskfest.account;

import de.hilling.taskfest.model.User;
import de.hilling.taskfest.service.UserService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import java.time.Instant;

/**
 * Turns a signed-in identity into its user, and refuses to bring a deleted account back through
 * a session that outlived it (#213).
 *
 * <p>The session lives in an encrypted cookie, so the server cannot end one held by another device:
 * after a deletion, that device's next request would recreate the account through
 * {@link UserService#getOrCreateByEmail}, newer than the deletion and so kept. A session whose ID
 * token was issued before the account's deletion is therefore answered as expired, and the user
 * signs in again -- which issues a new token and starts a new, empty account, as intended. Only the
 * creation of a user asks, so this costs one S3 request per new account, nothing per request.</p>
 */
@ApplicationScoped
public class AccountGate {

    private final UserService users;
    private final DeletionRecords records;
    private final AccountsConfig config;

    AccountGate(UserService users, DeletionRecords records, AccountsConfig config) {
        this.users = users;
        this.records = records;
        this.config = config;
    }

    /**
     * The user signed in with this email.
     *
     * @param email the email claim, which keys the user
     * @param tokenIssuedAt when the ID token was issued; the epoch when it does not say, which
     *     refuses it if the account was ever deleted
     * @throws WebApplicationException 401, when the session predates the account's deletion
     */
    public User signedIn(String email, Instant tokenIssuedAt) {
        User existing = users.findByEmail(email);
        if (existing != null) {
            return existing;
        }
        if (config.deletionsEnabled()
            && records.deletedAt(email).filter(deletedAt -> !tokenIssuedAt.isAfter(deletedAt)).isPresent()) {
            throw new WebApplicationException(Response.Status.UNAUTHORIZED);
        }
        return users.getOrCreateByEmail(email);
    }
}
