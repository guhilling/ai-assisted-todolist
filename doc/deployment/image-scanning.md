# Image scanning

**No image is scanned any more.** Amazon Inspector scanned the Quarkus backend's image, which ECS
pulled through ECR's pull-through cache for quay.io. The backend went in #559, and the cache,
Inspector and the registry's scanning configuration went from the account root in #557: the Go
backend runs as Lambda zips, not images. CodeQL analyses its code and Renovate keeps its
dependencies current.

The container architecture is the alternative, kept in the tag `pre-serverless`;
[this page as it was there](https://github.com/guhilling/ai-assisted-todolist/blob/pre-serverless/doc/deployment/image-scanning.md)
describes the scanning.
[decisions/deployment-and-aws.md](../decisions/deployment-and-aws.md#the-container-architecture-is-removed-from-the-infrastructure)
records the removal, and what is left to delete by hand: the repositories the cache created.