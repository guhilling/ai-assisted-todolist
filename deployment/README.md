# Deployment

Everything that deploys the app, in two directories with nothing shared between them:

| | |
| --- | --- |
| [`docker/`](docker/) | The Compose stack of the end-to-end run, which local development uses too |
| [`aws-tofu/`](aws-tofu/) | The AWS infrastructure, as OpenTofu |

`doc/deployment/` is the plan the AWS material implements and the place the reasoning lives;
`doc/local-development/end-to-end-stack.md` covers the Compose stack. Both directories carry a
README with the commands.

The split matters more than it looks: the Compose stack is **not** a model of the AWS
deployment. It runs a frontend container that AWS does not — there the frontend is static files
in S3 behind CloudFront, and the backend as a plain HTTP server rather than on Lambda — so a stack
that works locally is evidence about the backend and its stores, not about production shape.
