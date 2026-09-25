package io.github.guhilling.todo.api;

import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import java.net.URI;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * Drives the browser side of sign-in for a backend that acts as the frontend's
 * authentication broker.
 *
 * <p>The single-page app never sees an access token: Quarkus OIDC runs in
 * {@code web-app} mode, so the tokens stay server-side inside the encrypted
 * {@code q_session} cookie and the frontend only ever learns who is signed in. That is
 * why {@code /login} has no body worth speaking of — being {@code @Authenticated} is the
 * whole point, since the security layer intercepts the unauthenticated request and starts
 * the authorization code flow before this method is ever reached.</p>
 */
@Path("/api/auth")
public class AuthResource {

    @Inject
    JsonWebToken jwt;

    @ConfigProperty(name = "todo.post-login-redirect-uri", defaultValue = "/")
    String postLoginRedirectUri;

    @GET
    @Path("/login")
    @Authenticated
    public Response login() {
        return Response.seeOther(URI.create(postLoginRedirectUri)).build();
    }

    /**
     * Ends the local session by expiring {@code q_session}.
     *
     * <p>This is deliberately not an RP-initiated logout: the identity provider's own
     * session survives, so signing out here and back in again will not prompt for
     * credentials a second time. Browser tests that need a genuinely fresh identity have
     * to open a new browser context rather than relying on this.</p>
     */
    @GET
    @Path("/logout")
    public Response logout() {
        NewCookie expiredSessionCookie = new NewCookie.Builder("q_session")
            .path("/")
            .maxAge(0)
            .build();
        return Response.seeOther(URI.create(postLoginRedirectUri))
            .cookie(expiredSessionCookie)
            .build();
    }

    @GET
    @Path("/me")
    @Authenticated
    @Produces(MediaType.APPLICATION_JSON)
    public CurrentUserResponse me() {
        return new CurrentUserResponse(jwt.getClaim("email"));
    }

    /**
     * The identity the frontend is allowed to know about.
     *
     * <p>Only the email claim is exposed, because the email is the whole of this
     * application's notion of identity — see {@link io.github.guhilling.todo.model.User}.
     * Nothing else from the token needs to cross to the browser.</p>
     *
     * @param email the email claim of the signed-in user
     */
    public record CurrentUserResponse(String email) {
    }
}
