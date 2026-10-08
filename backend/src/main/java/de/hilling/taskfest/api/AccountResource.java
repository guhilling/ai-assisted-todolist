package de.hilling.taskfest.api;

import de.hilling.taskfest.account.AccountDeletion;
import io.quarkus.oidc.IdToken;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The signed-in user's own account (#213): for now, deleting it with everything it holds.
 *
 * <p>It acts on the caller and takes no id, so there is nothing to point at anyone else's
 * account. Signing out afterwards is the browser's next step; the session itself is not
 * touched here.</p>
 */
@Path("/api/account")
@Authenticated
@Tag(name = "Account", description = "The signed-in user's own account.")
public class AccountResource {

    /** The ID token, for the same reason as in {@code TaskResource}: Google's access token is opaque. */
    @Inject
    @IdToken
    JsonWebToken jwt;

    @Inject
    AccountDeletion deletion;

    @DELETE
    @Operation(summary = "Delete my account", description = "Deletes every task and every file of the "
        + "caller, and the account itself. It cannot be undone.")
    @APIResponse(responseCode = "204", description = "Deleted; sign out next.")
    public Response delete() {
        deletion.delete(jwt.getClaim(OidcClaims.EMAIL));
        return Response.noContent().build();
    }
}
