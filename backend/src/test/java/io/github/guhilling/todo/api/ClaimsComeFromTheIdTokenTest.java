package io.github.guhilling.todo.api;

import io.quarkus.oidc.IdToken;
import java.io.IOException;
import java.lang.reflect.Field;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.not;

/**
 * Holds every injected {@link JsonWebToken} in the backend to the ID token.
 *
 * <p>A bare {@code @Inject JsonWebToken} is the <em>access</em> token. Keycloak's is a JWT
 * carrying email, name and picture, so reading claims from it worked locally and in every test
 * — and Google's is opaque, so in qa every request that read one failed with "Opaque access
 * token can not be converted to JsonWebToken". The identity claims of a web application belong
 * to the ID token, {@code @IdToken}. Neither Keycloak nor the faked identity of
 * {@code @OidcSecurity} can produce an opaque access token, so the failure itself cannot be
 * reproduced here; this pins its cause instead, for every class rather than the two that had it.
 * Plain reflection over the compiled classes: no Quarkus, milliseconds.</p>
 */
class ClaimsComeFromTheIdTokenTest {

    private static final String ROOT_PACKAGE = "io.github.guhilling.todo";

    @Test
    void shouldFindTheClassesItChecks() throws Exception {
        assertThat(backendClasses(), not(empty()));
    }

    @Test
    void shouldReadEveryJsonWebTokenFromTheIdToken() throws Exception {
        List<String> accessTokenReaders = new ArrayList<>();
        for (Class<?> type : backendClasses()) {
            for (Field field : type.getDeclaredFields()) {
                if (JsonWebToken.class.equals(field.getType()) && !field.isAnnotationPresent(IdToken.class)) {
                    accessTokenReaders.add(type.getSimpleName() + "." + field.getName());
                }
            }
        }
        assertThat("these read claims from the access token, which Google issues opaque",
            accessTokenReaders, empty());
    }

    private static List<Class<?>> backendClasses() throws IOException, URISyntaxException, ClassNotFoundException {
        String path = ROOT_PACKAGE.replace('.', '/');
        List<Class<?>> classes = new ArrayList<>();
        for (URL url : Collections.list(ClaimsComeFromTheIdTokenTest.class.getClassLoader().getResources(path))) {
            Path root = Path.of(url.toURI());
            // Production classes only: target/test-classes holds the tests, which may inject
            // whatever they need to fake an identity.
            if (root.toString().contains("test-classes")) {
                continue;
            }
            try (Stream<Path> files = Files.walk(root)) {
                for (Path file : files.filter(f -> f.toString().endsWith(".class")).toList()) {
                    String relative = root.relativize(file).toString();
                    String name = ROOT_PACKAGE + "." + relative.substring(0, relative.length() - ".class".length())
                        .replace('/', '.');
                    classes.add(Class.forName(name, false, ClaimsComeFromTheIdTokenTest.class.getClassLoader()));
                }
            }
        }
        return classes;
    }
}
