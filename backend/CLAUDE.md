# CLAUDE.md — backend

Backend-specific guidance for the Quarkus service under `/backend`. Read
together with the repository root `CLAUDE.md` (ask-don't-guess, TDD, DDD, and
project context all still apply here).

## Testing strategy

- **Unit tests are the default and primary tool.** Most logic (domain rules,
  services, mappers) should be covered by plain, fast unit tests that don't
  boot Quarkus.
- **Integration tests** use Quarkus's own test support
  (`@QuarkusTest` / `@QuarkusIntegrationTest`, Dev Services) rather than
  hand-rolled test infrastructure. Use them where a real container context or
  the real database matters:
  - REST endpoint behavior end-to-end.
  - Database-backed persistence (repository/entity behavior against a real
    PostgreSQL instance via Quarkus Dev Services, not H2), since H2 doesn't
    reliably reflect PostgreSQL-specific behavior.
- Keep the two kinds separate and proportioned: many unit tests, a smaller
  set of integration tests for the seams that actually need a running
  Quarkus context or database.

## TDD

Every backend change — unit or integration level — starts with a failing
test. Write the test, watch it fail for the right reason, then implement.
Don't write backend production code without a test driving it first.

## Code quality tooling

- **JaCoCo** produces coverage reports, feeding **SonarCloud**, and is wired into the
  normal Maven lifecycle so coverage is generated on every test run.
- **The `quarkus-jacoco` extension is load-bearing, not redundant.** The stock JaCoCo
  agent cannot instrument the classes Quarkus rewrites at build time — the Panache
  entities and everything touching entity fields or static finders — because
  `QuarkusClassLoader` loads them. Without the extension those classes report 0% while
  the rest of the report looks fine, which once put backend line coverage at 41% when it
  was really 89%. Removing it fails nothing and silently halves the number.
- **Coverage is a gate, not a report.** `jacoco:check` runs at `verify` against the
  minimums in `pom.xml`. Raise them when coverage rises; never lower one to land a change.
- **Prefer a plain JUnit test when the logic is not about HTTP or persistence.**
  `AuthProviderMappingTest` is the model: it covers six configuration combinations in
  milliseconds, where the equivalent `@QuarkusTest` can only reach the single combination
  its profile declares.
- Whatever can be checked automatically (tests, coverage, style) must run in
  backend CI (`backend-ci.yml`) so violations fail the build, not just get
  caught by convention.

## Coding style

- Java sources follow the standard Sun/Oracle Java code conventions
  (4-space indentation, brace placement, naming conventions, import
  ordering, etc.) — the same style enforced by Checkstyle's `sun_checks.xml`.
- This style is **enforced**, not just a convention: wire Checkstyle into the
  Maven build (`sun_checks.xml` ruleset) so a style violation fails the
  build, and run it in CI.

## Database migrations

- Schema changes are managed with **Liquibase** changelogs, not the current
  `import.sql`/Hibernate-managed-schema approach. Every schema change gets
  its own changelog entry, checked in alongside the code that needs it.

## Logging

- Use **SLF4J** for all application logging (no direct use of a specific
  logging backend's API in application code).
- Log output format is environment-dependent: human-readable in local
  dev, but **structured JSON** when running in prod/QA, so logs can feed a
  centralized logging system.

## Metrics

- Expose metrics via **Quarkus Micrometer** (`quarkus-micrometer` with the
  Prometheus registry, `quarkus-micrometer-registry-prometheus`) — Quarkus's
  current standard metrics extension — rather than a custom metrics setup.

## Java / build

- Target the **latest available JDK (25), Temurin distribution**, in both
  `pom.xml` (`maven.compiler.release`, etc.) and CI (`actions/setup-java`
  with `distribution: temurin`).

## Container image

- For now, base backend container images on **Red Hat UBI minimal**
  (`registry.access.redhat.com/ubi9/ubi-minimal` or newer), installing the
  Temurin JDK explicitly into the image rather than using a JDK-preloaded
  base image (e.g. `ubi9/openjdk-*`). This is a deliberate current choice,
  not a fixed long-term decision — revisit if it stops making sense.

## Documentation

- **Every public type carries a Javadoc block** — classes, interfaces, enums and records,
  nested ones included. This is **enforced**: Checkstyle's `MissingJavadocType` fails
  `./mvnw verify` on a type without one.
- **The first sentence says what the type is _for_**, not what it is called. "Serves the
  sign-in cards the landing page offers before anyone is authenticated." — not "The auth
  provider resource." It ends with a period; `JavadocStyle` enforces that.
- **A second paragraph carries the _why_** where there is one: the collaborator the type
  exists to serve, the invariant it protects, or the alternative that was rejected and the
  reason. A type whose purpose really is self-evident gets one sentence and stops.
- **Per-member Javadoc stays optional**, deliberately — `@param`/`@return` ceremony on
  JAX-RS resources and CDI beans is noise. Add it only where it says something the
  signature does not, as `AuthResource.logout()` does. Records are the exception:
  `JavadocType` requires a `@param` per component once a block exists, and since the
  records _are_ the REST contract, documenting each field there is worth it.
- **No `@author`, `@version` or `@since`.** Git holds that.
- **Test classes get a block too**, saying which behaviour they pin down and at which layer
  — faked identity versus a real login, in-JVM versus packaged. Checkstyle does not scan
  `src/test`, so this one rests on habit.
- Anything larger than a single type belongs in `/doc`, and is updated in the same change
  as the behaviour it describes.
