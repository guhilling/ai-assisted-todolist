package io.github.guhilling.todo.api;

import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import java.net.URI;
import java.util.List;
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

    private static final String SESSION_COOKIE = "q_session";

    @Inject
    JsonWebToken jwt;

    @Context
    HttpHeaders httpHeaders;

    @ConfigProperty(name = "todo.post-login-redirect-uri", defaultValue = "/")
    String postLoginRedirectUri;

    @GET
    @Path("/login")
    @Authenticated
    public Response login() {
        return Response.seeOther(URI.create(postLoginRedirectUri)).build();
    }

    /**
     * Ends the local session by expiring every session cookie the browser sent.
     *
     * <p>Naming one cookie is not enough. Quarkus splits the session across
     * {@code q_session_chunk_1}, {@code q_session_chunk_2} and so on once the encrypted
     * tokens outgrow the 4 KB a single cookie holds, and whether it does that depends on how
     * large the tokens happen to be. Expiring only {@code q_session} therefore worked or
     * silently did nothing depending on the run, leaving people signed in after they had
     * asked to be signed out.</p>
     *
     * <p>This is deliberately not an RP-initiated logout: the identity provider's own
     * session survives, so signing out here and back in again will not prompt for
     * credentials a second time. Browser tests that need a genuinely fresh identity have
     * to open a new browser context rather than relying on this.</p>
     */
    @GET
    @Path("/logout")
    public Response logout() {
        Response.ResponseBuilder response = Response.seeOther(URI.create(postLoginRedirectUri));
        for (NewCookie expired : expiredSessionCookies()) {
            response.cookie(expired);
        }
        return response.build();
    }

    private List<NewCookie> expiredSessionCookies() {
        return httpHeaders.getCookies().values().stream()
            .map(Cookie::getName)
            .filter(AuthResource::isSessionCookie)
            .map(name -> new NewCookie.Builder(name).path("/").maxAge(0).build())
            .toList();
    }

    private static boolean isSessionCookie(String name) {
        // The chunks are q_session_chunk_N, and a named tenant would add its own suffix, so
        // match the prefix rather than enumerating the shapes.
        return name.equals(SESSION_COOKIE) || name.startsWith(SESSION_COOKIE + "_");
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
