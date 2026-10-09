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
  region, whatever region everything else lives in. The backend's own certificate, if the
  internal load balancer ever needs one, is separate and regional.
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
The backend uses `quarkus.oidc.authentication.redirect-path=/api/auth/callback`, and `/api/*`
routes through the same distribution, so the authorised redirect URIs are:

- `https://taskfest-qa.cloud.hilling.de/api/auth/callback`
- `https://taskfest.cloud.hilling.de/api/auth/callback`

This is manual configuration in the Google console and cannot be automated here.

**What is built** (#120), per environment:

- **The client id** is in `terraform.tfvars` (`google_client_id`). It is not a secret — it travels
  in every sign-in redirect. Empty, as in prod for now, keeps sign-in off in that environment.
- **The client secret** is `taskfest-<env>-google-client-secret` in Secrets Manager. OpenTofu
  creates it **empty**; a person puts the value in, so it never passes through the repository or
  OpenTofu state:

  ```sh
  aws secretsmanager put-secret-value --secret-id taskfest-qa-google-client-secret \
    --secret-string '<the client secret from the Google console>'
  ```

  The task **execution** role may read that one secret and injects it at task start as
  `TASKFEST_OIDC_GOOGLE_CLIENT_SECRET`. It does not rotate by itself, unlike the RDS master secret, so
  injection at start is fine; after changing it, start new tasks. About $0.40 a month, and it stays
  while the environment is down.
- **Behind CloudFront and the ALB** the backend sees the load balancer's connection, not the
  visitor's -- TLS since #247, with a certificate of its own the load balancer does not check --
  so it is told to believe the load balancer's `X-Forwarded-Proto` (`quarkus.http.proxy.*`, set in the task definition, trusted
  from inside the VPC only). Without that it asks Google to return to `http://…`, which Google
  rejects as an unregistered redirect URI. `SignInBehindProxyTest` pins it.
- **Who may sign in** is decided in the Google console: with the app in *Testing*, only the Google
  accounts listed as test users can.

## The test accounts' Cognito pool (qa)

qa has a second sign-in provider beside Google: a Cognito user pool with two test accounts,
`taskfest-test-one@example.com` and `taskfest-test-two@example.com`, which the live tests sign in
with (#141, #190). Unlike the Google client, all of it is code (`test-sign-in.tf`):

- **The pool** admits no sign-ups and has no MFA: the accounts are the only ones there will ever
  be, and a machine signs them in. Its hosted login page is Cognito's prefix domain,
  `taskfest-qa.auth.eu-central-1.amazoncognito.com` — no certificate, no DNS.
- **The app client** is confidential and returns to `https://taskfest-qa.cloud.hilling.de/api/auth/callback/cognito`,
  the provider's own callback (#143). Cognito generates its secret, so it is in OpenTofu state
  ([the decision](../decisions/deployment-and-aws.md)); ECS injects it from the SSM parameter
  `/taskfest/qa/cognito-client-secret`.
- **No password is stored anywhere.** The accounts are created without one; the live-test run
  sets a fresh random password before signing in, as the role `taskfest-qa-live-test`, which may
  do nothing else (#144).
- **The backend** declares the provider for the `prod` profile it runs in AWS, switched off; the
  task definition switches it on where the pool exists (`TASKFEST_OIDC_COGNITO_*`). Its button
  reads *Sign in with TaskFest test account*, with the TaskFest mark.

## The documentation site's own name

Google's consent screen asks for an application home page, a privacy policy and terms of service,
all under the authorised domain `hilling.de`. They are the GitHub Pages site, under
**`https://taskfest-docs.cloud.hilling.de/`**: the home page is the rendered README, and
[`privacy.md`](../privacy.md) and [`terms.md`](../terms.md) are linked from the footer of every page.
The name is a CNAME to `guhilling.github.io`, managed in the `account/` root
(`docs_hostname`), and the repository's Pages settings name the same host, which is what makes
GitHub serve the site there and issue its certificate.

