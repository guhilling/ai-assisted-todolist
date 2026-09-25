package io.github.guhilling.todo.support;

import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static io.restassured.RestAssured.given;

/**
 * Drives the real OIDC authorization code flow against the Keycloak instance started by
 * Quarkus Dev Services.
 *
 * <p>The application runs in {@code web-app} (BFF) mode, so there is no bearer token to hand
 * out: signing in means following the redirect to Keycloak, submitting the login form, and
 * letting the callback exchange the code for a {@code q_session} cookie. Both Keycloak and the
 * application keep state in cookies, so this class plays the part of the browser's cookie jar
 * and carries every cookie it is handed into the next request.</p>
 */
public final class KeycloakLoginFlow {

    private static final Pattern LOGIN_FORM_ACTION =
        Pattern.compile("id=\"kc-form-login\"[^>]*?action=\"([^\"]+)\"");

    private final Map<String, String> cookieJar = new HashMap<>();

    /**
     * Signs the given Keycloak user in and keeps the resulting session.
     *
     * @param username the Keycloak username, for example {@code gunnar}
     * @param password the user's password
     */
    public void signIn(String username, String password) {
        String authorizeUrl = location(
            send(unauthenticated().when().get("/api/auth/login")),
            "the application did not redirect to the OIDC provider");

        Response loginPage = send(unauthenticated().when().get(authorizeUrl));
        if (loginPage.statusCode() != 200) {
            throw new IllegalStateException("Keycloak did not serve a login page for " + authorizeUrl
                + ", status " + loginPage.statusCode() + ": " + loginPage.asString());
        }

        Response afterLogin = send(unauthenticated()
            .contentType(ContentType.URLENC)
            .formParam("username", username)
            .formParam("password", password)
            .when().post(loginFormAction(loginPage.asString())));
        String callbackUrl = location(afterLogin,
            "Keycloak rejected the credentials for " + username + ": " + afterLogin.asString());

        Response callback = send(unauthenticated().when().get(callbackUrl));
        if (callback.statusCode() / 100 != 3) {
            throw new IllegalStateException("the application did not accept the authorization code, status "
                + callback.statusCode() + ": " + callback.asString());
        }
    }

    /**
     * @return a request specification carrying the session established by {@link #signIn}
     */
    public RequestSpecification authenticated() {
        return given().cookies(cookieJar);
    }

    /**
     * Follows the application's sign-out endpoint and applies whatever cookie changes it asks
     * for, so the jar afterwards is what a browser would be left holding.
     */
    public void signOut() {
        Response response = unauthenticated().when().get("/api/auth/logout");
        if (response.statusCode() / 100 != 3) {
            throw new IllegalStateException("sign-out did not redirect, status " + response.statusCode());
        }
        response.getDetailedCookies().asList().stream()
            .filter(cookie -> cookie.getMaxAge() == 0)
            .forEach(cookie -> cookieJar.remove(cookie.getName()));
    }

    /**
     * @return the names of the session cookies the jar currently holds, chunked or not
     */
    public List<String> sessionCookieNames() {
        return cookieJar.keySet().stream()
            .filter(name -> name.equals("q_session") || name.startsWith("q_session_"))
            .sorted()
            .toList();
    }

    private RequestSpecification unauthenticated() {
        // The redirect targets are already percent-encoded; letting Rest Assured encode them a
        // second time turns redirect_uri into a value Keycloak rejects.
        return given().cookies(cookieJar).urlEncodingEnabled(false).redirects().follow(false);
    }

    private Response send(Response response) {
        cookieJar.putAll(response.getCookies());
        return response;
    }

    private static String location(Response response, String failureMessage) {
        String location = response.getHeader("Location");
        if (response.statusCode() / 100 != 3 || location == null) {
            throw new IllegalStateException(failureMessage + ", status " + response.statusCode());
        }
        return location;
    }

    private static String loginFormAction(String loginPageHtml) {
        Matcher matcher = LOGIN_FORM_ACTION.matcher(loginPageHtml);
        if (!matcher.find()) {
            throw new IllegalStateException("no Keycloak login form found on the sign-in page");
        }
        return matcher.group(1).replace("&amp;", "&");
    }
}
