# Names and certificates

The zone `cloud.hilling.de` already exists in Route 53.

| Environment | Host |
| --- | --- |
| QA | `todolist-qa.cloud.hilling.de` |
| Prod | `todolist.cloud.hilling.de` |

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

- `https://todolist-qa.cloud.hilling.de/api/auth/callback`
- `https://todolist.cloud.hilling.de/api/auth/callback`

This is manual configuration in the Google console and cannot be automated here.

**What is built** (#120), per environment:

- **The client id** is in `terraform.tfvars` (`google_client_id`). It is not a secret — it travels
  in every sign-in redirect. Empty, as in prod for now, keeps sign-in off in that environment.
- **The client secret** is `todolist-<env>-google-client-secret` in Secrets Manager. OpenTofu
  creates it **empty**; a person puts the value in, so it never passes through the repository or
  OpenTofu state:

  ```sh
  aws secretsmanager put-secret-value --secret-id todolist-qa-google-client-secret \
    --secret-string '<the client secret from the Google console>'
  ```

  The task **execution** role may read that one secret and injects it at task start as
  `TASKFEST_OIDC_GOOGLE_CLIENT_SECRET`. It does not rotate by itself, unlike the RDS master secret, so
  injection at start is fine; after changing it, start new tasks. About $0.40 a month, and it stays
  while the environment is down.
- **Behind CloudFront and the ALB** the backend sees plain HTTP, so it is told to believe the
  load balancer's `X-Forwarded-Proto` (`quarkus.http.proxy.*`, set in the task definition, trusted
  from inside the VPC only). Without that it asks Google to return to `http://…`, which Google
  rejects as an unregistered redirect URI. `SignInBehindProxyTest` pins it.
- **Who may sign in** is decided in the Google console: with the app in *Testing*, only the Google
  accounts listed as test users can.

## The documentation site's own name

Google's consent screen asks for an application home page, a privacy policy and terms of service,
all under the authorised domain `hilling.de`. They are the GitHub Pages site, under
**`https://todolist-docs.cloud.hilling.de/`**: the home page is the rendered README, and
[`privacy.md`](../privacy.md) and [`terms.md`](../terms.md) are linked from the footer of every page.
The name is a CNAME to `guhilling.github.io`, managed in the `account/` root
(`docs_hostname`), and the repository's Pages settings name the same host, which is what makes
GitHub serve the site there and issue its certificate.

