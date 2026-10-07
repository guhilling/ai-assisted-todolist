# Mutation testing

Coverage says a line ran. Mutation testing asks a harder question: if that line were
changed, would any test notice? PIT compiles small changes into the bytecode — negate a
condition, return null, swap a boolean — and reports which ones no test caught.

```bash
cd backend
./mvnw verify                                     # runs it as part of the normal build
./mvnw org.pitest:pitest-maven:mutationCoverage   # just this, about 2 seconds
open target/pit-reports/index.html                # which mutants survived, line by line
```

Currently **71 mutants, 55 killed** (October 2026, #143). The rest are all in the logging classes
from #122: 15 without coverage in `RequestLog.handle`/`write` and `SignInLog.log` — the Vert.x
handler and CDI observer that only `@QuarkusTest`s reach — and one surviving boundary in
`RequestLog.requestId`. Every kill names the test that caught it, so the report doubles as
evidence that the plain unit tests are doing real work rather than merely executing lines.

**This one reports; it does not block.** Unlike the coverage gates there is no threshold,
because three production classes of ten are in scope: a gate there would police a corner of
the codebase while saying nothing about the other seven, which is a worse signal than an
honest report. `backend-ci.yml` uploads `pit-report` as an artifact on every backend run, so the
result is readable without running anything locally. Revisit the decision if the scope
widens.

## PIT cannot run a `@QuarkusTest`

This is the constraint that shapes everything else. PIT runs each mutant in a fresh minion
JVM, so a `@QuarkusTest` in scope means a full application boot — with its own Dev Services
PostgreSQL and Keycloak containers — per mutant. Measured on this codebase:

| Scope | Result |
| --- | --- |
| `AuthProviderResource`, covered by a plain unit test | 10 mutants, 2 seconds, all killed |
| `UserService`, covered by a `@QuarkusTest` | 14 mutants, **163 seconds**, most minions timed out |
| One lightweight `@QuarkusTest` allowed into scope | coverage calculation goes from under 1s to **24s** |
| The whole suite in scope | **aborts before mutating anything** — `KeycloakLoginFlowTest` cannot start its containers inside the minion, and PIT requires a green suite |

Worth knowing: PIT counts a timed-out or errored minion as a killed mutant, so the
`@QuarkusTest` run reported "100% killed" while actually proving nothing. A mutant that
merely stops the application booting scores the same as one a test genuinely caught. This
is why the scope is narrow rather than merely slow.

## The allowlist, and the pressure it applies

`targetTests` names the non-Quarkus test classes explicitly instead of matching a pattern,
because that way the failure mode is benign: a new plain unit test is simply not mutated
until it is listed, whereas a pattern that swept in a new `@QuarkusTest` would make every
run minutes slower without saying so.

`targetClasses` stays deliberately **wide**, and the production classes with no fast unit
test are excluded one line at a time in `excludedClasses`. So a new production class is in
scope by default and shows up in the report as uncovered mutants instead of being silently
absent — deleting the `AuthResource` exclusion, for instance, adds eight `NO_COVERAGE`
mutants and takes the reported score from 100% to 56%.

Being wide informs rather than enforces, since nothing fails. It only works if somebody
reads the report, which is why it is uploaded as an artifact rather than left in `target/`.

The exclusion list is therefore a to-do list, and it has been collected on: `service.*`
narrowed to `service.UserService*` when `GravatarUrl` and `GravatarService` earned plain unit
tests, taking the run from 10 mutants to 21 and all of them killed. Every remaining line is a
class whose behaviour is only pinned down by tests too heavy to mutate, and deleting a line is
the reward for writing a fast one — remembering to add the new test to `targetTests`, or it is
written but never used.

