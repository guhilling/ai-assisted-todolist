# Backend

```bash
cd backend
./mvnw verify          # tests, JaCoCo coverage, and Checkstyle
./mvnw test            # tests only
./mvnw checkstyle:check
```

Dev Services starts PostgreSQL automatically, and Keycloak **only for the tests that sign in**,
so a container engine has to be running. Keycloak follows `taskfest.auth.enabled`: the plain
`test` profile has sign-in off and neither starts Keycloak nor enables the OIDC tenant, while
`KeycloakLoginFlowTest` and `SignInBehindProxyTest` switch sign-in on in their profiles and get
one. Each Keycloak start costs about 25 s, and every test profile restarts Quarkus with its
Dev Services, so this halved backend CI (#134). A new test that needs a real sign-in turns
`taskfest.auth.enabled` on in its profile; one that only needs a user uses `@TestSecurity`, which
needs no Keycloak at all. Fifty-two tests across ten classes:

- **`AuthProviderMappingTest`** — the only test here that does not boot Quarkus. Provider
  availability is a decision about configuration, so feeding `AuthProvidersConfig` directly
  covers every combination of enabled/credentials/issuer in milliseconds, where a
  `@QuarkusTest` can only ever exercise the one combination its profile declares.
- **`TaskTest`** — the description length constraint, and that Hibernate populates and
  maintains the audit timestamps. Needs a real database precisely because that is engine
  behaviour.
- **`UserServiceTest`** — create-on-first-sight, across two separate transactions, because
  that is how production calls it.
- **`TaskResourceTest`** — the REST contract with identity faked by `@TestSecurity` /
  `@OidcSecurity`. Fast, and able to switch identity freely; proves nothing about sign-in.
  Covers all four verbs, the ownership 404s, due-date ordering, and every shape the
  validation constraints reject.
- **`AuthProviderResourceTest`** — with authentication off, no provider is offered as usable.
- **`AuthResourceTest`** — what `/api/auth/me` tells the browser when the provider supplied a
  name, a picture, both or neither. Faked claims are the point: a real login could only ever
  exercise whatever the identity provider happens to put in its token.
- **`GravatarUrlTest`** and **`GravatarServiceTest`** — the address derived from an email, and
  the probe that decides whether a picture is there. The second runs against a local
  `HttpServer` rather than gravatar.com, so it can exercise 200, 404, a server that never
  answers and an interrupted lookup without depending on the internet.
- **`AttachmentPolicyTest`** — the allowed kinds, the size and count limits, and the cleaning of
  a file name for a `Content-Disposition` header, without booting anything.
- **`AttachmentResourceTest`** — attachments end to end against S3 in LocalStack, under
  `AttachmentStorageProfile`, which only the classes that need S3 use -- this one, the orphan
  clean-up's and the account deletion's -- so the rest never start that container: announce, a real PUT
  to the presigned link, confirm, list, open, remove; the refusals; ownership; and a deleted
  task's attachments coming back with its undo, then swept. The profile switches LocalStack's
  signature validation **on** — it is off by default, and then S3 accepting only the signed size
  goes untested.
- **`AttachmentEnumColumnTest`** — the attachment kind and state columns are the database's
  own enums, with the same labels as the Java enums.
- **`AccountResourceTest`** and **`DeletionReplayTest`** — deleting one's own account (#213)
  against LocalStack: everything the caller holds goes, nobody else's data is touched, an
  interrupted deletion finishes when asked again, and an account a restore brought back is deleted
  again unless it was created after the deletion, and a session left open elsewhere starts a new,
  empty account. **`AccountWithoutRecordsTest`** deletes an account where records are switched off,
  as in the local container stack. **`DeletionRecordsHashTest`** pins the record's key
  with a known SHA-256, because a record written by one release must be found by the next;
  **`DeletionPruningTest`** and **`RdsRestorePointsTest`** (a fake RDS client, since LocalStack has
  none) cover when a record may go.
- **`KeycloakLoginFlowTest`** — the real authorization code flow (see below).
- **`MetricsResourceTest`** — `/q/metrics` is actually exposed, since Micrometer
  contributes it through configuration that nothing else would notice breaking.

## The real sign-in test

`KeycloakLoginFlowTest`, with its helper `support/KeycloakLoginFlow`, is the one that
exercises the path production uses: it follows the redirect to Keycloak, scrapes the login
form's action URL, posts credentials, follows the callback, and then uses the API with the
session cookie that results. It also signs both local accounts in and proves neither sees
the other's tasks.

Two details in the helper exist because of real failures, and should not be "tidied away":

- **`urlEncodingEnabled(false)`.** The authorize URL is already percent-encoded; letting
  RestAssured encode it again produces a `redirect_uri` Keycloak rejects outright.
- **A hand-rolled cookie jar.** RestAssured's `CookieFilter` did not carry Keycloak's
  cookies across the redirects, which surfaced as "Restart login cookie not found".
