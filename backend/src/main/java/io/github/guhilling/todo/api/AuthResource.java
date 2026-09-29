package io.github.guhilling.todo.api;

import io.github.guhilling.todo.service.GravatarService;
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
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.ExampleObject;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

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
@Tag(name = "Authentication", description = "The browser side of sign-in, sign-out, and the current session.")
public class AuthResource {

    private static final String SESSION_COOKIE = "q_session";

    @Inject
    JsonWebToken jwt;

    @Inject
    GravatarService gravatar;

    @Context
    HttpHeaders httpHeaders;

    @ConfigProperty(name = "todo.post-login-redirect-uri", defaultValue = "/")
    String postLoginRedirectUri;

    @GET
    @Path("/login")
    @Authenticated
    @Operation(summary = "Start or complete sign-in",
        description = "Being @Authenticated is the whole point: an unauthenticated request is intercepted "
            + "by the OIDC authorization code flow before this method ever runs.")
    @APIResponse(responseCode = "303", description = "Sign-in succeeded; redirects to the post-login URI.")
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
    @Operation(summary = "End the local session", description = "Expires every session cookie the browser "
        + "sent; the identity provider's own session is untouched.")
    @APIResponse(responseCode = "303", description = "Signed out; redirects to the post-login URI.")
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
    @Operation(summary = "The signed-in identity", description = "The only identity the frontend is allowed "
        + "to know about.")
    @APIResponse(responseCode = "200", description = "The signed-in user.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            examples = @ExampleObject(name = "currentUser", value = """
                {
                  "email": "person@example.com",
                  "name": "Person Example",
                  "pictureUrl": "https://example.com/avatar.jpg"
                }""")))
    @APIResponse(responseCode = "401", description = "No one is signed in.")
    public CurrentUserResponse me() {
        String email = jwt.getClaim("email");
        String picture = jwt.getClaim("picture");

        // Gravatar is consulted only when the provider supplied nothing. Google almost always
        // does; Keycloak here never does, which is what keeps this path exercised in dev.
        if (picture == null) {
            picture = gravatar.avatarUrlFor(email).orElse(null);
        }

        return new CurrentUserResponse(email, jwt.getClaim("name"), picture);
    }

    /**
     * The identity the frontend is allowed to know about.
     *
     * <p>The email is still the whole of this application's notion of identity — it is what
     * {@link io.github.guhilling.todo.model.User} is keyed by and what ownership is decided on.
     * The name and picture are not identity: they are how the signed-in person is shown their
     * own session, read from the token on each request and stored nowhere. That is deliberate,
     * and it is why adding them needed no migration; see {@code doc/decisions.md}.</p>
     *
     * <p>Both may be null. A provider need not supply either, and the frontend is expected to
     * fall back rather than assume.</p>
     *
     * @param email the email claim of the signed-in user, always present
     * @param name the provider's display name for them, or null when it supplied none
     * <p>Only {@code email} is required in the generated schema, and the other two are marked
     * nullable, because the frontend compiles that schema into a runtime validator. They are
     * sent as null rather than omitted, so a validator that did not allow null would reject a
     * perfectly ordinary response.</p>
     *
     * @param pictureUrl the provider's picture, or a Gravatar for the address, or null for neither
     */
    @Schema(requiredProperties = {"email"})
    public record CurrentUserResponse(
        @Schema(example = "person@example.com") String email,
        @Schema(example = "Person Example", nullable = true) String name,
        @Schema(example = "https://example.com/avatar.jpg", nullable = true) String pictureUrl
    ) {
    }
}
