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

    public record CurrentUserResponse(String email) {
    }
}
