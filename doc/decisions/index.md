# Decisions

Decisions with consequences, why they were taken, and what was rejected. Newest last.

## [Domain, backend and persistence](domain-and-backend.md)

- [Panache active-record entities](domain-and-backend.md#panache-active-record-entities)
- [Liquibase, not Hibernate-managed schema](domain-and-backend.md#liquibase-not-hibernate-managed-schema)
- [The due-date rule applies to filing a task, not to changing one](domain-and-backend.md#the-due-date-rule-applies-to-filing-a-task-not-to-changing-one)
- [The database defines the enums, and the changelogs were squashed to say so](domain-and-backend.md#the-database-defines-the-enums-and-the-changelogs-were-squashed-to-say-so)
- [The schema carries the constraints, and every string has a bound](domain-and-backend.md#the-schema-carries-the-constraints-and-every-string-has-a-bound)
- [Wire identifiers are constants, and a GET's query count is asserted](domain-and-backend.md#wire-identifiers-are-constants-and-a-gets-query-count-is-asserted)

## [Authentication](authentication.md)

- [Backend-for-frontend authentication](authentication.md#backend-for-frontend-authentication)
- [One OIDC tenant, switched per profile](authentication.md#one-oidc-tenant-switched-per-profile)
- [Provider availability comes from configuration](authentication.md#provider-availability-comes-from-configuration)
- [Name and picture are session data, not identity](authentication.md#name-and-picture-are-session-data-not-identity)
- [Gravatar is asked by the backend, and that buys accuracy rather than privacy](authentication.md#gravatar-is-asked-by-the-backend-and-that-buys-accuracy-rather-than-privacy)

## [Frontend and user interface](frontend.md)

- [The board is the front page; the project description is a link](frontend.md#the-board-is-the-front-page-the-project-description-is-a-link)
- [A checkbox for done, a quiet marker for in progress](frontend.md#a-checkbox-for-done-a-quiet-marker-for-in-progress)
- [The look follows hilling.it, and the calendar loads on demand](frontend.md#the-look-follows-hillingit-and-the-calendar-loads-on-demand)
- [Editing starts from the menu, and waits for the server](frontend.md#editing-starts-from-the-menu-and-waits-for-the-server)
- [Due dates are relative words, set from defaults](frontend.md#due-dates-are-relative-words-set-from-defaults)
- [Undo instead of a confirmation, and what it costs](frontend.md#undo-instead-of-a-confirmation-and-what-it-costs)
- [Importance is a dot, and the word is still there](frontend.md#importance-is-a-dot-and-the-word-is-still-there)
- [A task id is checked before it is put in a URL](frontend.md#a-task-id-is-checked-before-it-is-put-in-a-url)
- [Responses are validated against the schema the backend publishes](frontend.md#responses-are-validated-against-the-schema-the-backend-publishes)
- [Spacing and type are scales, not values](frontend.md#spacing-and-type-are-scales-not-values)

## [Testing](testing.md)

- [Quarkus Dev Services, not hand-rolled Testcontainers](testing.md#quarkus-dev-services-not-hand-rolled-testcontainers)
- [Testing sign-in through the real code flow](testing.md#testing-sign-in-through-the-real-code-flow)
- [Coverage is measured by `quarkus-jacoco`, and gates the build](testing.md#coverage-is-measured-by-quarkus-jacoco-and-gates-the-build)
- [The end-to-end suite contributes no coverage](testing.md#the-end-to-end-suite-contributes-no-coverage)
- [Mutation testing, scoped to the tests that do not boot Quarkus](testing.md#mutation-testing-scoped-to-the-tests-that-do-not-boot-quarkus)

## [Build, release and dependencies](build-and-dependencies.md)

- [Jib with a pinned Java 25 base image](build-and-dependencies.md#jib-with-a-pinned-java-25-base-image)
- [sun_checks with documented relaxations](build-and-dependencies.md#sun_checks-with-documented-relaxations)
- [Apache License 2.0, as a `LICENSE` file only](build-and-dependencies.md#apache-license-20-as-a-license-file-only)
- [A release is a git tag, and the version lives nowhere else](build-and-dependencies.md#a-release-is-a-git-tag-and-the-version-lives-nowhere-else)
- [SNAPSHOT dependencies fail every build, not just releases](build-and-dependencies.md#snapshot-dependencies-fail-every-build-not-just-releases)
- [Renovate merges the small updates and asks about the large ones](build-and-dependencies.md#renovate-merges-the-small-updates-and-asks-about-the-large-ones)
- [CodeQL scanning, unfiltered by path](build-and-dependencies.md#codeql-scanning-unfiltered-by-path)
- [The runner is pinned, so an image migration is a decision](build-and-dependencies.md#the-runner-is-pinned-so-an-image-migration-is-a-decision)
- [Pages deploys only from `main`](build-and-dependencies.md#pages-deploys-only-from-main)
- [Misconfiguration scanning is static, in CI, with Trivy — not AWS Config](build-and-dependencies.md#misconfiguration-scanning-is-static-in-ci-with-trivy-not-aws-config)
- [SonarCloud runs on `main` only, and a failed quality gate becomes an issue](build-and-dependencies.md#sonarcloud-runs-on-main-only-and-a-failed-quality-gate-becomes-an-issue)

## [Containers and the local stack](containers-and-local-stack.md)

- [Compose files under `deployment/docker/`](containers-and-local-stack.md#compose-files-under-deploymentdocker)
- [Compose probes live in scripts, not inline](containers-and-local-stack.md#compose-probes-live-in-scripts-not-inline)
- [The frontend is served by Red Hat's hardened httpd](containers-and-local-stack.md#the-frontend-is-served-by-red-hats-hardened-httpd)
- [The backend runs on our own jre-runtime: Temurin's JRE on UBI micro](containers-and-local-stack.md#the-backend-runs-on-our-own-jre-runtime-temurins-jre-on-ubi-micro)

## [Deployment on AWS](deployment-and-aws.md)

- [Tearing an environment down is a parameter, not a destroy](deployment-and-aws.md#tearing-an-environment-down-is-a-parameter-not-a-destroy)
- [Deploy identities are OIDC roles, scoped to deploying and nothing else](deployment-and-aws.md#deploy-identities-are-oidc-roles-scoped-to-deploying-and-nothing-else)
- [OpenTofu rather than Terraform](deployment-and-aws.md#opentofu-rather-than-terraform)
- [One AWS account, with IAM roles and resource tags](deployment-and-aws.md#one-aws-account-with-iam-roles-and-resource-tags)
- [What it costs is stated rather than glossed](deployment-and-aws.md#what-it-costs-is-stated-rather-than-glossed)
- [PostgreSQL on RDS, destroyed with a final snapshot when idle](deployment-and-aws.md#postgresql-on-rds-destroyed-with-a-final-snapshot-when-idle)
- [The application authenticates to RDS with IAM, not a password](deployment-and-aws.md#the-application-authenticates-to-rds-with-iam-not-a-password)
- [The database user is created by a one-off ECS task, run by a person](deployment-and-aws.md#the-database-user-is-created-by-a-one-off-ecs-task-run-by-a-person)
- [The frontend is static on S3 behind CloudFront, with `/api/*` on the same distribution](deployment-and-aws.md#the-frontend-is-static-on-s3-behind-cloudfront-with-api-on-the-same-distribution)
- [GitHub Actions, not CodePipeline](deployment-and-aws.md#github-actions-not-codepipeline)
- [Two deployment paths rather than expand-and-contract](deployment-and-aws.md#two-deployment-paths-rather-than-expand-and-contract)
- [The load balancer stays, and is internal](deployment-and-aws.md#the-load-balancer-stays-and-is-internal)
- [Custom hostnames under an existing zone](deployment-and-aws.md#custom-hostnames-under-an-existing-zone)
- [Fargate tasks in public subnets, with no NAT gateway](deployment-and-aws.md#fargate-tasks-in-public-subnets-with-no-nat-gateway)
- [VPC flow logs go to S3, all traffic, for 30 days](deployment-and-aws.md#vpc-flow-logs-go-to-s3-all-traffic-for-30-days)
- [CloudFront's `/api/*` origin comes and goes with the environment; the distribution stays](deployment-and-aws.md#cloudfronts-api-origin-comes-and-goes-with-the-environment-the-distribution-stays)
- [CloudFront reaches the load balancer over HTTPS with the environment's own name](deployment-and-aws.md#cloudfront-reaches-the-load-balancer-over-https-with-the-environments-own-name)
- [ECS-native blue/green, which needed AWS provider 6](deployment-and-aws.md#ecs-native-bluegreen-which-needed-aws-provider-6)
- [The frontend's deep links are a CloudFront Function, and a release needs no invalidation](deployment-and-aws.md#the-frontends-deep-links-are-a-cloudfront-function-and-a-release-needs-no-invalidation)
- [Image vulnerabilities come from Amazon Inspector, through ECR's pull-through cache](deployment-and-aws.md#image-vulnerabilities-come-from-amazon-inspector-through-ecrs-pull-through-cache)
