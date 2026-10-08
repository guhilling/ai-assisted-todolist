package de.hilling.taskfest.api;

import de.hilling.taskfest.account.AccountDeletion;
import io.quarkus.oidc.IdToken;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The signed-in user's own account (#213): for now, deleting it with everything it holds.
 *
 * <p>It acts on the caller and takes no id, so there is nothing to point at anyone else's
 * account. The response expires this browser's session cookies, as signing out does; a session
 * another device still holds is refused by {@code AccountGate} instead, since an encrypted cookie
 * cannot be ended from the server.</p>
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

    @Context
    HttpHeaders httpHeaders;

    @DELETE
    @Operation(summary = "Delete my account", description = "Deletes every task and every file of the "
        + "caller, and the account itself. It cannot be undone.")
    @APIResponse(responseCode = "204", description = "Deleted, and this browser's session ended.")
    public Response delete() {
        deletion.delete(jwt.getClaim(OidcClaims.EMAIL));
        Response.ResponseBuilder response = Response.noContent();
        for (NewCookie expired : SessionCookies.expired(httpHeaders, name -> true)) {
            response.cookie(expired);
        }
        return response.build();
    }
}
