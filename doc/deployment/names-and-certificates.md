# Names and certificates

The zone `cloud.hilling.de` already exists in Route 53.

| Environment | Host |
| --- | --- |
| QA | `taskfest-qa.cloud.hilling.de` |
| Prod | `taskfest.cloud.hilling.de` |

Each is an A and AAAA alias record pointing at that environment's CloudFront distribution;
alias records to CloudFront are not charged.

**Two things that catch people, both worth knowing before building:**

- **The certificate must be in `us-east-1`.** CloudFront only accepts ACM certificates from that
  region, whatever region everything else lives in. The HTTP API answers on its own AWS name and
  needs none of ours.
- **The zone and the environments are in the same account**, which is one of the reasons that
  decision was reverted — no cross-account role, no subdomain delegation, and ACM's DNS
  validation writes its record directly.

**Alias records, not `CNAME`s**, and the cost difference is real though small here. Route 53 does
not charge for queries to an alias record that points at an AWS resource; a `CNAME` is a standard
record at **$0.40 per million queries**, and a `CNAME` pointing at another name in the same zone
is billed as **two** queries because the resolver has to ask twice. At demo traffic that is
fractions of a cent either way — but an alias is free, avoids the second lookup, and is the only
one of the two that would work at a zone apex. There is no case for the `CNAME`.

## The Google OIDC configuration

Fixed hostnames make these knowable now, so they can be set up once the environments exist.
The backend's callback is `/api/auth/callback`, the Quarkus backend's path, which the Go backend
kept, and `/api/*` routes through the same distribution, so the authorised redirect URIs are:

- `https://taskfest-qa.cloud.hilling.de/api/auth/callback`
- `https://taskfest.cloud.hilling.de/api/auth/callback`

This is manual configuration in the Google console and cannot be automated here.

**What is built** (#120), per environment:

- **The client id** is in `terraform.tfvars` (`google_client_id`). It is not a secret — it travels
  in every sign-in redirect. Each environment has a web client of its own, in its own Google
  project, and a client secret of its own.
  An empty id keeps sign-in off in that environment.
- **The client secret** is `taskfest-<env>-google-client-secret` in Secrets Manager. OpenTofu
    creates it **empty**; a person puts the value in, so it never passes through the repository or
    OpenTofu state:

    ```sh
    aws secretsmanager put-secret-value --secret-id taskfest-qa-google-client-secret \
      --secret-string '<the client secret from the Google console>'
    ```

    The `api` function's role may read that one secret, which the function reads at a cold start
    (`TASKFEST_OIDC_GOOGLE_CLIENT_SECRET_ARN`). It does not rotate by itself; after changing it,
    redeploy the release that runs, so that every instance starts afresh. About $0.40 a month.
- **Behind CloudFront and the HTTP API** the backend does not build its callback from the request:
  it takes its own address from `TASKFEST_PUBLIC_ORIGIN`, `https://<hostname>`, so Google is always
  asked to return to the registered redirect URI.
- **Who may sign in** is decided in the Google console, on the Google Auth Platform's *Audience*
  page: in *Testing*, only the Google accounts listed as test users (at most 100); *In production*,
  anyone with a Google account (#607). With only `openid`, `email` and `profile`, publishing needs
  no verification review. Without brand verification the consent screen shows the domain rather
  than the app's name and logo; brand verification usually takes two to three working days, and a
  later change to the branding needs it again. Going back to *Testing* is not described in
  Google's documentation: check the *Audience* page offers it before relying on it. **qa gets a
  Google project of its own**, kept in *Testing*, since the publishing status is a project's and
  not a client's; only prod's project is published, once qa has moved out of it
  ([decision](../decisions/authentication.md#qa-signs-in-with-a-google-project-of-its-own)).

## Sign in with Apple (#281)

A further provider on the website, beside Google; its code is generic
([authentication.md](../authentication.md)). **prod only**: Apple keeps no list of test users, so on
qa it would let anyone in, and qa is for invited testers
([decision](../decisions/authentication.md#qa-signs-in-with-a-google-project-of-its-own)). What
Apple needs is made by hand in the Apple developer account, *Certificates, Identifiers & Profiles*:

- **A Services ID** for the website, with *Sign in with Apple* configured: the domain
  `taskfest.cloud.hilling.de`, and as return URL
  `https://taskfest.cloud.hilling.de/api/auth/callback/apple`.
- **A key** with *Sign in with Apple*: the `.p8` file, downloadable once, its key id and the team
  id.

Then, in prod, in three steps, because an empty key would stop the function's every start:

1. `apple_sign_in` in `terraform.tfvars` with the Services ID, key id and team id, `offered = false`;
   applied, it creates the secret `taskfest-<env>-apple-signing-key`, empty (about $0.40 a month).
2. The key put in by hand, never through the repository or state:

    ```sh
    aws secretsmanager put-secret-value --secret-id taskfest-prod-apple-signing-key \
      --secret-string file://AuthKey_<key id>.p8
    ```

3. `offered = true`, applied: the function's settings name the provider, and its button appears.

## The test accounts' Cognito pool (qa)



qa has a second sign-in provider beside Google: a Cognito user pool with two test accounts,
`taskfest-test-one@example.com` and `taskfest-test-two@example.com`, which the live tests sign in
with (#141, #190). Unlike the Google client, all of it is code (`test-sign-in.tf`):

- **The pool** admits no sign-ups and has no MFA: the accounts are the only ones there will ever
  be, and a machine signs them in. Its hosted login page is Cognito's prefix domain,
  `taskfest-qa.auth.eu-central-1.amazoncognito.com` — no certificate, no DNS.
- **The app client** is confidential and returns to `https://taskfest-qa.cloud.hilling.de/api/auth/callback/cognito`,
  the provider's own callback (#143). Cognito generates its secret, so it is in OpenTofu state
  ([the decision](../decisions/deployment-and-aws.md)), and the `api` function gets it in its
  settings.
- **The mobile app's client** (#267) is public — an installed app cannot keep a secret — and returns
  to the qa build's scheme, `de.hilling.taskfest.qa://oauthredirect`, through the system browser
  with PKCE. The app drops its refresh tokens (#633). The backend accepts its ID tokens as bearer tokens
  because the function's settings name it (`TASKFEST_OIDC_COGNITO_AUDIENCES`); the qa build of the
  app is given the issuer and the client id from the outputs `test_accounts_issuer` and
  `test_accounts_app_client_id`.
- **No password is stored anywhere.** The accounts are created without one; the live-test run
  sets a fresh random password before signing in, as the role `taskfest-qa-live-test`, which may
  do nothing else (#144).
- **The backend** offers the provider where the pool exists: the function's settings name it in
  `TASKFEST_AUTH_PROVIDERS` and configure it (`TASKFEST_OIDC_COGNITO_*`). Its button reads
  *Sign in with TaskFest test account*, with the TaskFest mark.

## The documentation site's own name

Google's consent screen asks for an application home page, a privacy policy and terms of service,
all under the authorised domain `hilling.de`. They are the GitHub Pages site, under
**`https://taskfest-docs.cloud.hilling.de/`**: the home page is the rendered README, and
[`privacy.md`](../privacy.md) and [`terms.md`](../terms.md) are linked from the footer of every page.
The name is a CNAME to `guhilling.github.io`, managed in the `account/` root
(`docs_hostname`), and the repository's Pages settings name the same host, which is what makes
GitHub serve the site there and issue its certificate.

