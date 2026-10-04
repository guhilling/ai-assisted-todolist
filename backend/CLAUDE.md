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
- **Mutation testing with PIT runs at `verify`, and reports without blocking.** It is
  deliberately not a gate: three production classes of ten are in scope, so a threshold would
  police a corner of the codebase while saying nothing about the rest. It is scoped that way
  because PIT gives each mutant its own minion JVM, and a `@QuarkusTest` in scope means a
  full boot with its own Dev Services containers per mutant. `doc/testing/mutation-testing.md` has the
  measurements, and the report lands as a CI artifact on every backend run.
- **PIT's `excludedClasses` list is a to-do list, not configuration.** Each entry is a
  production class with no fast unit test. Deleting an entry is the reward for writing the
  test; adding one needs a stated reason. It has been collected on once: `service.*` narrowed
  to `service.UserService*` when the Gravatar classes earned plain unit tests, which took the
  run from 10 mutants to 21. Add a new plain test to `targetTests` at the same time, or it is
  written but never used.
- **A `TODO:` comment fails Checkstyle.** To-dos are GitHub issues, not comments (#121). The
  `TodoComment` check matches the marker `TODO:` only, so the domain word — `TaskState.TODO`,
  the `TODO_…` environment variables — is untouched. It also replaces Sonar's S1135, which cannot
  be narrowed and is switched off in `sonar-project.properties`.
- Whatever can be checked automatically (tests, coverage, style) must run in backend CI
  (`backend-ci.yml`) so violations fail the build, not just get caught by convention. The
  mutation score is the deliberate exception, on the grounds above.

## Coding style

- Java sources follow the standard Sun/Oracle Java code conventions
  (4-space indentation, brace placement, naming conventions, import
  ordering, etc.) — the same style enforced by Checkstyle's `sun_checks.xml`.
- This style is **enforced**, not just a convention: wire Checkstyle into the
  Maven build (`sun_checks.xml` ruleset) so a style violation fails the
  build, and run it in CI.
- **Use the enum, never a string literal that repeats one of its constants.** This holds in
  test code as much as in production code: `"HIGH"` in a test is a second definition of
  `TaskImportance` in a place the compiler cannot check, so renaming a constant leaves the
  tests compiling and asserting the old name.
  - Where a string really is required — a JSON request body, a JSONPath assertion — derive it
    from the enum at that one boundary rather than giving up: pass the enum into the test
    helper and call `.name()` inside it, and assert with `equalTo(TaskState.DONE.name())`. The
    literal then exists once, beside the serialisation, instead of once per test.
  - The exception is a test whose subject is an *invalid* value. Checking that the backend
    rejects an unknown state needs a string the enum deliberately does not contain, so there is
    no constant to use.
  - The other exception is an annotation. `@Schema(example = "TODO")` cannot call
    `TaskState.TODO.name()`, because an annotation value must be a compile-time constant and a
    method call is not one. Those literals stay.

## Magic strings

- **A string that identifies something on a wire is a constant, not a literal.** Claim names,
  header names, cookie names: misspelling one compiles, passes a test that stubs it with the
  same misspelling, and shows up as an empty field in the browser.
- **Look for the standard constant before declaring one.** Where it exists, use it:
  `OidcClaims.EMAIL` is `Claims.email.name()` from MicroProfile JWT, not a string of our own.
- **Write down what the library does not cover**, so the next person does not repeat the
  search. MicroProfile's `Claims` has no `picture`, and its `full_name` is a different claim
  from OpenID Connect's `name` — both are declared in `OidcClaims` with that noted.
- **Not everything repeated is a magic string.** The component names inside
  `@Schema(requiredProperties = ...)` are the record's own fields; replacing them with
  constants would make them harder to read, not safer. Prefer removing the list altogether by
  putting `@NotNull` on the components, which is what most of the records now do.

## Database access

- **A GET runs a constant number of statements.** One is the aim, two or three are fine, and
  the count must never grow with the number of rows returned. That growth is an N+1: invisible
  in development where everyone has three tasks, expensive against a real database, and silent
  — the responses stay correct and only the statement count moves.
- **Enforce it by counting, not by reading the code**, because the change that causes it is
  usually somewhere else: a lazy association touched while mapping a response, a fetch mode
  altered, a field added to a response record. `TaskQueryCountTest` clears Hibernate's
  statistics, calls the endpoint and asserts the count both stays under the limit and does not
  move when ten more rows exist. `%test.quarkus.hibernate-orm.statistics=true` is what makes
  the count readable, and it is deliberately test-only.
- **Keep associations `LAZY`** and do not touch them while building a response. If a response
  genuinely needs one, fetch it in the same query rather than per row.

## Input validation

Constraints are the schema. SmallRye turns Jakarta Bean Validation annotations into the
published JSON Schema, and the frontend compiles that schema into the validators it checks
every response with, so an annotation here is enforced in the browser as well as on the wire.

- **`@NotNull` by default.** A component that may legitimately be absent is the exception and
  says so, with `@Schema(nullable = true)`. On a response record `@NotNull` has no runtime
  effect -- nothing validates an outgoing object -- but it is what marks the property required
  in the schema, and it cannot drift from the components the way a
  `@Schema(requiredProperties = ...)` list on the type can.
  - The exception is a field that is **required but nullable**, like `AuthProviderResponse`'s
    `loginUrl`, and a primitive like `available`. `@NotNull` would assert something untrue of
    the first and nothing of the second, so those records list their required properties on the
    type instead, with a comment saying why.
- **Bound every string with `@Size`.** An unbounded string is one the board would render
  however long it arrived, and for a persisted field it is a 500 waiting for a long value. The
  bounds are in `doc/decisions/domain-and-backend.md`; the constant lives next to the field it constrains.
- **Constrain responses, not only requests.** The backend validates what it is sent, but what
  makes the *frontend* safe is the schema, and the schema comes from these annotations.
- **`@Email` is runtime-only.** SmallRye puts nothing in the schema for it, so add
  `@Schema(format = "email")` when the document should say what the string is. Measured, not
  assumed.
- **Do not use `Optional` in a record that appears on the wire.** It costs the operation its
  schema reference: `content` keeps its examples and loses `schema`, so nothing can tell what
  the endpoint returns. `Optional` in service and internal signatures is fine and preferred.
- **An `@APIResponse` with `@Content` must set `schema`.** Specifying `@Content` for the
  examples alone *suppresses* the schema SmallRye would have derived. Every operation here once
  lost its response schema that way, and nothing noticed until a test asserted it.

## Database migrations

- Schema changes are managed with **Liquibase** changelogs, not the current
  `import.sql`/Hibernate-managed-schema approach. Every schema change gets
  its own changelog entry, checked in alongside the code that needs it.
- **An enum belongs in the database as an enum**, not as a `VARCHAR`. Map it with
  `@Enumerated(EnumType.STRING)` plus `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` and a
  `@Column(columnDefinition = "...")` naming the type; create the type in the changelog with
  raw `<sql>`, since Liquibase has no change type for it.
- When a type and a Java enum have to agree, **assert it in a test** rather than trusting the
  two files to be edited together. `TaskEnumColumnTest` compares the type's labels to the
  enum's constants, so drift fails the build instead of the first request.

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

- **Jib builds the image onto `eclipse-temurin:25.0.4.1_1-jre-ubi10-minimal`**, set
  by `quarkus.jib.base-jvm-image` in `application.properties`. No Dockerfile, no
  daemon-side build.
- **Temurin on a Red Hat base, pinned to an exact build.** The JRE is the same
  Temurin the project compiles and tests with, so there is one Java version to
  keep straight; the base under it is UBI. The tag does not float, because
  `25-jre-ubi10-minimal` moves and two builds of one commit could then sit on
  different bases. Renovate moves the pin through a custom regex manager in
  `.github/renovate.json` — no built-in manager reads a Quarkus properties file,
  and a pom property would not have helped, since the Maven manager updates
  dependency versions rather than container references.
- **The pin is load-bearing — never drop it.** Jib's default base ships JDK 21
  while this code is compiled for 25, so on the default the container exits
  immediately and silently on class file version 69. When
  `maven.compiler.release` moves, move this tag in the same change.
- **`src/main/jib/` is copied into the image as-is.** It holds the RDS CA bundle at
  `opt/rds/global-bundle.pem`, which the AWS JDBC URL names as `sslrootcert` so that
  `sslmode=verify-full` can check the server. It is AWS's public bundle, downloaded from
  `truststore.pki.rds.amazonaws.com`, and is not a secret.
- **There are no Dockerfiles under `backend/`, deliberately.** The four Quarkus
  generated (`Dockerfile.jvm`, `.legacy-jar`, `.native`, `.native-micro`) were
  deleted: nothing built them, two were JDK 17 based and so were a trap, and none
  was ever exercised by a test or by CI. `backend/.dockerignore` went with them,
  since it only ever mattered to a `docker build` in that directory. If a
  Dockerfile build is genuinely needed, add `quarkus-container-image-docker` and
  write one on purpose rather than restoring scaffolding.

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
