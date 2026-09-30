package io.github.guhilling.todo.api;

import org.eclipse.microprofile.jwt.Claims;

/**
 * The names of the OpenID Connect claims this application reads from a token.
 *
 * <p>They were string literals at each call site. A claim name is a wire identifier, and
 * misspelling one does not fail to compile, does not fail a test that stubs the token with the
 * same misspelling, and shows up only as an empty field in the browser.</p>
 *
 * <p>The standard library covers exactly one of them, which is worth writing down so nobody
 * repeats the search. MicroProfile's {@link Claims} enum names each claim by its own
 * {@code name()}, and it has {@code email} but no {@code picture}. It does have
 * {@code full_name}, which is <em>not</em> OpenID Connect's {@code name} claim: the enum
 * constant is called {@code full_name} and so is the claim it stands for. The other two are
 * declared here, marked as the OpenID Connect standard claims they are.</p>
 */
final class OidcClaims {

    /** The signed-in user's email address, and this application's whole notion of identity. */
    static final String EMAIL = Claims.email.name();

    /**
     * The display name. An OpenID Connect standard claim with no MicroProfile constant; see the
     * class comment for why {@link Claims#full_name} is not it.
     */
    static final String NAME = "name";

    /** The profile picture URL. An OpenID Connect standard claim with no MicroProfile constant. */
    static final String PICTURE = "picture";

    private OidcClaims() {
    }
}
