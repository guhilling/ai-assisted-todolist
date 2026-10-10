package de.hilling.taskfest.support;

import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import org.eclipse.microprofile.config.ConfigProvider;

import static io.restassured.RestAssured.given;

/**
 * Asks the Keycloak of Dev Services for an ID token directly, the way an installed app ends up
 * holding one (#266).
 *
 * <p>An app signs in through the system browser or the platform's own sign-in and keeps the ID
 * token it is given. A test has no browser to do that with, so it uses Keycloak's password grant,
 * which hands out the same token for the same user and client. Every client this is used with
 * has {@code directAccessGrantsEnabled}.</p>
 */
public final class KeycloakTokens {

    private KeycloakTokens() {
    }

    /**
     * An ID token for a user, issued by one realm to one of its clients.
     *
     * @param realm the realm, such as {@code taskfest}
     * @param clientId the client the token is issued to, which becomes its audience
     * @param clientSecret the client's secret, or null for a public client
     * @param username the user's name in that realm
     * @param password the user's password
     * @return the raw ID token, a signed JWT
     */
    public static String idToken(String realm, String clientId, String clientSecret, String username,
                                 String password) {
        RequestSpecification request = given()
            .contentType(ContentType.URLENC)
            .formParam("grant_type", "password")
            .formParam("scope", "openid")
            .formParam("client_id", clientId)
            .formParam("username", username)
            .formParam("password", password);
        if (clientSecret != null) {
            request.formParam("client_secret", clientSecret);
        }
        Response response = request.when().post(keycloakUrl() + "/realms/" + realm + "/protocol/openid-connect/token");
        if (response.statusCode() != 200) {
            throw new IllegalStateException("Keycloak issued no token for " + username + " in " + realm
                + ", status " + response.statusCode() + ": " + response.asString());
        }
        return response.jsonPath().getString("id_token");
    }

    /** Where Dev Services started Keycloak, as it tells the application. */
    private static String keycloakUrl() {
        return ConfigProvider.getConfig().getValue("keycloak.url", String.class);
    }
}
