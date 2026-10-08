package de.hilling.taskfest.api;

import de.hilling.taskfest.service.GravatarService;
import de.hilling.taskfest.model.User;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import java.net.URI;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import io.quarkus.oidc.IdToken;
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

    /**
     * How long a provider's display name may be. It is not stored, so nothing but the schema
     * bounds it, and an identity provider is free to send whatever it likes.
     */
    private static final int MAX_DISPLAY_NAME_LENGTH = 255;

    /**
     * The practical ceiling for a URL, which is what browsers have long enforced. Generous on
     * purpose: a provider's picture URL carries size and crop parameters and is routinely a
     * few hundred characters.
     */
    private static final int MAX_URL_LENGTH = 2048;

    private static final String SESSION_COOKIE = SessionCookies.SESSION_COOKIE;

    /**
     * Quarkus OIDC's state cookie, {@code q_auth} or {@code q_auth_<tenant>}, set while a sign-in
     * is under way. One left behind by an abandoned sign-in decides which provider answers later
     * requests, so a completed sign-in clears them all.
     */
    private static final String STATE_COOKIE = "q_auth";

    /**
     * The ID token, deliberately: a bare {@code JsonWebToken} is the access token, which Google
     * issues opaque, so reading claims from it failed every signed-in request in qa.
     * {@code ClaimsComeFromTheIdTokenTest} holds every class to this.
     */
    @Inject
    @IdToken
    JsonWebToken jwt;

    @Inject
    GravatarService gravatar;

    @Context
    HttpHeaders httpHeaders;

    @ConfigProperty(name = "taskfest.post-login-redirect-uri", defaultValue = "/")
    String postLoginRedirectUri;

    @GET
    @Path("/login")
    @Authenticated
    @Operation(summary = "Start or complete sign-in",
        description = "Being @Authenticated is the whole point: an unauthenticated request is intercepted "
            + "by the OIDC authorization code flow before this method ever runs.")
    @APIResponse(responseCode = "303", description = "Sign-in succeeded; redirects to the post-login URI.")
    public Response login() {
        return signedInWith(SESSION_COOKIE);
    }

    /**
     * Starts or completes sign-in with one particular provider, when a deployment has more than
     * one (#143).
     *
     * <p>Each additional provider is a named OIDC tenant whose {@code tenant-paths} is this path
     * with its id, which is how the security layer knows whom to send the browser to. As with
     * {@link #login()}, the body only runs once there is a session: it sends the browser back to
     * the app.</p>
     *
     * @param provider the provider's id, such as {@code cognito}; resolved by the tenant's path,
     *     so the body never needs it
     */
    @GET
    @Path("/login/{provider}")
    @Authenticated
    @Operation(summary = "Start or complete sign-in with one provider",
        description = "For every provider but the deployment's main one, which uses /api/auth/login. The "
            + "provider list names each provider's path.")
    @APIResponse(responseCode = "303", description = "Sign-in succeeded; redirects to the post-login URI.")
    public Response loginWith(
        @PathParam("provider") @Size(max = AuthProviderResource.MAX_PROVIDER_ID_LENGTH) String provider) {
        return signedInWith(SESSION_COOKIE + "_" + provider);
    }

    /**
     * Back to the app, signed in with one provider only: every other provider's session cookies
     * are expired on the way.
     *
     * <p>A browser holding two providers' sessions would be one person or the other, depending on
     * which cookie Quarkus looked at first (#143). This runs once the sign-in has completed --
     * Quarkus returns the browser to the path that started it -- so the new session is in place
     * when the old one goes.</p>
     *
     * @param session the name of the session cookie the provider just signed in with
     */
    private Response signedInWith(String session) {
        Response.ResponseBuilder response = Response.seeOther(URI.create(postLoginRedirectUri));
        for (NewCookie expired : SessionCookies.expired(httpHeaders, name -> !belongsTo(name, session))) {
            response.cookie(expired);
        }
        httpHeaders.getCookies().keySet().stream()
            .filter(name -> name.equals(STATE_COOKIE) || name.startsWith(STATE_COOKIE + "_"))
            .forEach(name -> response.cookie(new NewCookie.Builder(name).path("/").maxAge(0).build()));
        return response.build();
    }

    /** Whether a cookie is that session or one of its chunks ({@code <session>_chunk_N}). */
    private static boolean belongsTo(String cookie, String session) {
        return cookie.equals(session) || cookie.startsWith(session + "_chunk_");
    }

    /**
     * Ends the local session by expiring every session cookie the browser sent
     * ({@link SessionCookies} says why that means every one).
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
        for (NewCookie expired : SessionCookies.expired(httpHeaders, name -> true)) {
            response.cookie(expired);
        }
        return response.build();
    }

    @GET
    @Path("/me")
    @Authenticated
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "The signed-in identity", description = "The only identity the frontend is allowed "
        + "to know about.")
    @APIResponse(responseCode = "200", description = "The signed-in user.",
        content = @Content(mediaType = MediaType.APPLICATION_JSON,
            schema = @Schema(implementation = CurrentUserResponse.class),
            examples = @ExampleObject(name = "currentUser", value = """
                {
                  "email": "person@example.com",
                  "name": "Person Example",
                  "pictureUrl": "https://example.com/avatar.jpg"
                }""")))
    @APIResponse(responseCode = "401", description = "No one is signed in.")
    public CurrentUserResponse me() {
        String email = jwt.getClaim(OidcClaims.EMAIL);
        String picture = jwt.getClaim(OidcClaims.PICTURE);

        // Gravatar is consulted only when the provider supplied nothing. Google almost always
        // does; Keycloak here never does, which is what keeps this path exercised in dev.
        if (picture == null) {
            picture = gravatar.avatarUrlFor(email).orElse(null);
        }

        return new CurrentUserResponse(email, jwt.getClaim(OidcClaims.NAME), picture);
    }

    /**
     * The identity the frontend is allowed to know about.
     *
     * <p>The email is still the whole of this application's notion of identity — it is what
     * {@link de.hilling.taskfest.model.User} is keyed by and what ownership is decided on.
     * The name and picture are not identity: they are how the signed-in person is shown their
     * own session, read from the token on each request and stored nowhere. That is deliberate,
     * and it is why adding them needed no migration; see {@code doc/decisions/authentication.md}.</p>
     *
     * <p>Both may be null. A provider need not supply either, and the frontend is expected to
     * fall back rather than assume.</p>
     *
     * @param email the email claim of the signed-in user, always present
     * @param name the provider's display name for them, or null when it supplied none
     * <p>Only {@code email} carries {@code @NotNull}, so only it is required in the generated
     * schema; the other two are marked nullable, because the frontend compiles that schema into
     * a runtime validator and they are sent as null rather than omitted. A validator that did
     * not allow null would reject a perfectly ordinary response.</p>
     *
     * <p>{@code @Email} is runtime validation only: SmallRye puts nothing in the schema for it,
     * which is why {@code format} says so separately. The lengths are the published bounds from
     * {@code doc/decisions/domain-and-backend.md}.</p>
     *
     * @param pictureUrl the provider's picture, or a Gravatar for the address, or null for neither
     */
    public record CurrentUserResponse(
        @NotNull @Email @Size(max = User.MAX_EMAIL_LENGTH)
        @Schema(example = "person@example.com", format = "email") String email,
        @Size(max = MAX_DISPLAY_NAME_LENGTH)
        @Schema(example = "Person Example", nullable = true) String name,
        @Size(max = MAX_URL_LENGTH)
        @Schema(example = "https://example.com/avatar.jpg", nullable = true) String pictureUrl
    ) {
    }
}
