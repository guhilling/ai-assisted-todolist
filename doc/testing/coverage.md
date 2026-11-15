# Coverage

| | Measured by | Enforced by | At |
| --- | --- | --- | --- |
| Frontend | `@vitest/coverage-v8` → `coverage/lcov.info` | `coverage.thresholds` | `npm run test:coverage` |
| Go backend | `go test -coverprofile` → `serverless/coverage.out` | nothing yet: reported only | `sonarcloud.yml` |

SonarCloud reads both reports; it does not measure anything itself. The Quarkus backend had a
JaCoCo gate of its own until #559 (95% line, 90% branch); why it needed `quarkus-jacoco` to
measure at all is on this page in the tag `pre-serverless`.

## The end-to-end suite is deliberately not counted

Nothing from the Playwright run reaches the coverage figure: the backend runs in a container
built without coverage, and the frontend is a minified production bundle. This is a choice,
not an oversight. The e2e suite exists to prove the real stack works — real redirects, real
cookies, real persistence — and folding it into coverage would inflate the number in exactly
the way that hides missing unit tests. A line that only a browser test ever reaches is a
line with no unit test, and the number should say so.

## The thresholds

Frontend 95% on all four counters. It sits just below what the suite actually achieves (100%), so a
genuinely defensive branch does not fail the build on the day it is written. **Raise them when
coverage rises; do not lower them to fit a change.**

