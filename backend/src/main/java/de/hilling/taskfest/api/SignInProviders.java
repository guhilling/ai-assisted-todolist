package de.hilling.taskfest.api;

import de.hilling.taskfest.api.AuthProviderResource.AuthProvidersConfig;
import io.quarkus.oidc.runtime.OidcUtils;
import io.quarkus.runtime.StartupEvent;
import io.vertx.ext.web.Router;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.eclipse.microprofile.config.Config;

/**
 * Knows the deployment's sign-in providers as Quarkus OIDC sees them: which one is the main
 * provider, which are named tenants, and where each one's sign-in starts (#143).
 *
 * <p>The main provider is Quarkus' default tenant and signs in at {@code /api/auth/login}. Every
 * other provider is a named tenant whose {@code tenant-paths} include {@code /api/auth/login/<id>}.
 * Read once from configuration, and used by the provider list, the sign-in endpoint and the log
 * lines, so all three agree.</p>
 *
 * <p>Two mistakes fail loudly here instead of quietly signing someone in with the wrong provider:
 * a configuration in which more than one usable provider lacks a tenant -- only one can be the main
 * one, so a forgotten or misspelt {@code tenant-paths} stops the start-up -- and a request for
 * {@code /api/auth/login/<id>} naming no provider, which gets a 404 before authentication would
 * fall back to the main provider.</p>
 *
 * <p>The tenant attribute's name and the default tenant's id come from {@code OidcUtils}, a
 * runtime class of Quarkus OIDC. The multitenancy guide documents exactly these two, and
 * {@code ProviderInLogsTest} fails if a Quarkus upgrade changes them.</p>
 */
@ApplicationScoped
public class SignInProviders {

    /** Quarkus OIDC's id for its default tenant: the main provider's. */
    public static final String DEFAULT_TENANT = OidcUtils.DEFAULT_TENANT_ID;

    /** Where the main provider's sign-in starts. */
    static final String MAIN_LOGIN_PATH = "/api/auth/login";

    private static final String NAMED_LOGIN_PREFIX = MAIN_LOGIN_PATH + "/";

    /** What a log line calls the main provider when no usable provider is configured at all. */
    private static final String NO_MAIN_PROVIDER = "default";

    /** Each named tenant's own login path, by provider id. */
    private final Map<String, String> namedLoginPaths;

    private final Optional<String> mainProvider;

    /** Providers whose tenant is switched off: not part of this deployment at all. */
    private final Set<String> switchedOff;

    private final List<String> problems;

    @Inject
    SignInProviders(AuthProvidersConfig providers, Config config) {
        this(providers, tenantPaths(providers, config), switchedOff(providers, config));
    }

    private SignInProviders(AuthProvidersConfig providers, Map<String, List<String>> tenantPaths,
                            Set<String> switchedOff) {
        this.switchedOff = Set.copyOf(switchedOff);
        Map<String, String> named = new TreeMap<>();
        tenantPaths.forEach((id, paths) -> paths.stream()
            .filter(path -> path.startsWith(NAMED_LOGIN_PREFIX))
            .findFirst()
            .ifPresent(path -> named.put(id, path)));
        this.namedLoginPaths = Map.copyOf(named);

        List<String> mainCandidates = providers.providers().entrySet().stream()
            .filter(entry -> AuthProviderResource.isAvailable(providers.enabled(), entry.getValue()))
            .map(Map.Entry::getKey)
            .filter(id -> !switchedOff.contains(id))
            .filter(id -> !named.containsKey(id))
            .sorted()
            .toList();
        this.mainProvider = mainCandidates.stream().findFirst();

        List<String> found = new ArrayList<>();
        if (mainCandidates.size() > 1) {
            found.add("Providers " + mainCandidates + " are all usable without a tenant of their own, but only "
                + "one can be the main provider: give the others a quarkus.oidc.<id> tenant whose tenant-paths "
                + "include " + NAMED_LOGIN_PREFIX + "<id>.");
        }
        this.problems = List.copyOf(found);
    }

    /**
     * The providers as configured, with each id's {@code tenant-paths} given directly.
     *
     * @param providers the {@code taskfest.auth} tree
     * @param tenantPaths each provider id's tenant paths; absent for the main provider
     * @return the providers
     */
    static SignInProviders of(AuthProvidersConfig providers, Map<String, List<String>> tenantPaths) {
        return new SignInProviders(providers, tenantPaths, Set.of());
    }

    private static Set<String> switchedOff(AuthProvidersConfig providers, Config config) {
        Set<String> off = new TreeSet<>();
        for (String id : providers.providers().keySet()) {
            if (!isTenantEnabled(id, config)) {
                off.add(id);
            }
        }
        return off;
    }

    private static boolean isTenantEnabled(String id, Config config) {
        return config.getOptionalValue("quarkus.oidc." + id + ".tenant-enabled", Boolean.class).orElse(true);
    }

    private static Map<String, List<String>> tenantPaths(AuthProvidersConfig providers, Config config) {
        Map<String, List<String>> paths = new TreeMap<>();
        for (String id : providers.providers().keySet()) {
            // A tenant switched off -- prod's test accounts, say -- is no provider of its own.
            if (isTenantEnabled(id, config)) {
                config.getOptionalValues("quarkus.oidc." + id + ".tenant-paths", String.class)
                    .ifPresent(found -> paths.put(id, found));
            }
        }
        return paths;
    }

    /**
     * @param id a provider's id
     * @return where that provider's sign-in starts, if it is a named tenant; empty for the main one
     */
    public Optional<String> loginPath(String id) {
        return Optional.ofNullable(namedLoginPaths.get(id));
    }

    /**
     * @param id a provider's id
     * @return whether it is a named tenant, signing in at {@code /api/auth/login/<id>}
     */
    public boolean isNamedTenant(String id) {
        return namedLoginPaths.containsKey(id);
    }

    /**
     * The provider id a tenant stands for, as the provider list knows it.
     *
     * @param tenantId the tenant Quarkus OIDC recorded on an identity
     * @return the main provider's id for the default tenant, the tenant's own id otherwise
     */
    public String providerOfTenant(String tenantId) {
        return DEFAULT_TENANT.equals(tenantId) ? mainProvider.orElse(NO_MAIN_PROVIDER) : tenantId;
    }

    /**
     * Whether a provider's tenant is switched off -- declared, but not part of this deployment, like
     * prod's test accounts (#190). Such a provider is left out of the provider list altogether and
     * can never be the main one, whatever credentials it has.
     *
     * @param id a provider's id
     * @return whether it is switched off
     */
    public boolean isSwitchedOff(String id) {
        return switchedOff.contains(id);
    }

    /**
     * @return what is wrong with this configuration, one sentence per problem; empty when nothing is
     */
    public List<String> problems() {
        return problems;
    }

    /** Refuses to start with a configuration in which a button would sign in with the wrong provider. */
    void checkAtStartup(@Observes StartupEvent startup) {
        if (!problems.isEmpty()) {
            throw new IllegalStateException(String.join(" ", problems));
        }
    }

    /**
     * Answers {@code /api/auth/login/<id>} for an id that names no provider with a 404.
     *
     * <p>Ahead of the security handlers, which would otherwise authenticate the request with the
     * main provider: a path matched by no tenant falls back to the default one.</p>
     */
    void refuseUnknownProviders(@Observes Router router) {
        router.route(NAMED_LOGIN_PREFIX + ":provider").order(-1).handler(context -> {
            if (isNamedTenant(context.pathParam("provider"))) {
                context.next();
            } else {
                context.response().setStatusCode(Response.Status.NOT_FOUND.getStatusCode()).end();
            }
        });
    }

    /** The attribute under which Quarkus OIDC records the tenant on an identity. */
    public static String tenantAttribute() {
        return OidcUtils.TENANT_ID_ATTRIBUTE;
    }
}
