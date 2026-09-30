# Deployment

Everything that deploys the app, in two directories with nothing shared between them:

| | |
| --- | --- |
| [`docker/`](docker/) | The Compose stacks — local development and the end-to-end run |
| [`aws-tofu/`](aws-tofu/) | The AWS infrastructure, as OpenTofu |

`doc/deployment.md` is the plan the AWS material implements and the place the reasoning lives;
`doc/local-development.md` covers the Compose stacks. Both directories carry a README with the
commands.

The split matters more than it looks: the Compose stacks are **not** a model of the AWS
deployment. They run a frontend container that AWS does not — there the frontend is static files
in S3 behind CloudFront — so a stack that works locally is evidence about the backend and the
database, not about production shape.
