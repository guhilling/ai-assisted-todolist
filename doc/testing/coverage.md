# Coverage

| | Measured by | Enforced by | At |
| --- | --- | --- | --- |
| Backend | `quarkus-jacoco` → `target/jacoco-report` | `jacoco:check` | `./mvnw verify` |
| Frontend | `@vitest/coverage-v8` → `coverage/lcov.info` | `coverage.thresholds` | `npm run test:coverage` |

SonarCloud reads both reports; it does not measure anything itself.

## Why `quarkus-jacoco` is not optional

The JaCoCo Maven plugin on its own reported **0% for `TaskResource`, `UserService`, `Task`
and `User`** — the four most heavily tested classes in the project — while reporting
correctly for everything else. Those four are exactly the classes Quarkus rewrites at build
time: the two Panache entities, and the two classes that touch entity fields or static
finders. They are loaded by `QuarkusClassLoader`, which the stock agent cannot instrument,
so their execution never reached the `.exec` file at all. Backend line coverage read 41%
when the real figure was 89%.

`io.quarkus:quarkus-jacoco` reports against the bytecode Quarkus actually runs. **Removing
it silently returns those four classes to zero** — the build still passes, the report still
generates, and the number just quietly drops. The Maven plugin is still present, but only
for its agent (tests that do not boot Quarkus) and its `check` goal; its `report` execution
was removed, because it would overwrite the correct report with the broken one.

Both write `target/jacoco-quarkus.exec`, which is why `quarkus.jacoco.reuse-data-file=true`
is set: without it the extension wipes what the Maven agent recorded.

If a local run shows a number you cannot explain, check the age of
`target/jacoco-quarkus.exec`. The agent appends, so a file that survives across runs without
a `clean` accumulates — the old `target/jacoco.exec` had grown to 58 MB and still held
classes deleted months earlier.

## The end-to-end suite is deliberately not counted

Nothing from the Playwright run reaches the coverage figure: the backend runs in a container
with no agent attached, and the frontend is a minified production bundle. This is a choice,
not an oversight. The e2e suite exists to prove the real stack works — real redirects, real
cookies, real persistence — and folding it into coverage would inflate the number in exactly
the way that hides missing unit tests. A line that only a browser test ever reaches is a
line with no unit test, and the number should say so.

## The thresholds

Backend 95% line / 90% branch; frontend 95% on all four counters. Each sits just below what
the suite actually achieves (98%/93% and 100%), so a genuinely defensive branch does not
fail the build on the day it is written. **Raise them when coverage rises; do not lower them
to fit a change.**

