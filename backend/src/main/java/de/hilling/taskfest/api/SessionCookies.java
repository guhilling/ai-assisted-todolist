package de.hilling.taskfest.api;

import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.NewCookie;
import java.util.List;
import java.util.function.Predicate;

/**
 * Expiring the session cookies a browser sent, which is how this application ends a session: the
 * session is an encrypted cookie, with nothing on the server to end. Signing out and deleting an
 * account (#213) both do it.
 *
 * <p>Naming one cookie is not enough. Quarkus splits the session across {@code q_session_chunk_1},
 * {@code q_session_chunk_2} and so on once the encrypted tokens outgrow the 4 KB a single cookie
 * holds, and whether it does that depends on how large the tokens happen to be. Expiring only
 * {@code q_session} therefore worked or silently did nothing depending on the run.</p>
 */
final class SessionCookies {

    /** The session cookie's name, and the prefix of its chunks and of named tenants' sessions. */
    static final String SESSION_COOKIE = "q_session";

    private SessionCookies() {
    }

    /** An expired copy of every session cookie the browser sent that {@code which} accepts. */
    static List<NewCookie> expired(HttpHeaders headers, Predicate<String> which) {
        return headers.getCookies().values().stream()
            .map(Cookie::getName)
            .filter(SessionCookies::isSessionCookie)
            .filter(which)
            .map(name -> new NewCookie.Builder(name).path("/").maxAge(0).build())
            .toList();
    }

    private static boolean isSessionCookie(String name) {
        // The chunks are q_session_chunk_N, and a named tenant would add its own suffix, so
        // match the prefix rather than enumerating the shapes.
        return name.equals(SESSION_COOKIE) || name.startsWith(SESSION_COOKIE + "_");
    }
}
