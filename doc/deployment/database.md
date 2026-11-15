# The database

**There is no database server any more.** The container architecture's PostgreSQL on RDS, its IAM
sign-in, the one-off `migrate` and `db-bootstrap` tasks and the restore of a final snapshot on
`env.sh up` were removed from the infrastructure in #557. The Go backend keeps its data in one
DynamoDB table ([serverless.md](serverless.md)), with its own backups and restores
([serverless.md](serverless.md#restoring-the-table)).

**The final RDS snapshots are deleted** (`taskfest-<env>-db-final-…`, manual snapshots of the
instance `taskfest-<env>-db`): Gunnar deleted all three on 2026-11-15. They held the containers'
data, which did not move to the table
([prod starts the Go backend with an empty table](../decisions/deployment-and-aws.md#prod-starts-the-go-backend-with-an-empty-table)),
so that data is gone, and the way back would start with an empty database.

The container architecture is the alternative, kept in the tag `pre-serverless`;
[this page as it was there](https://github.com/guhilling/ai-assisted-todolist/blob/pre-serverless/doc/deployment/database.md)
describes the database.
[decisions/deployment-and-aws.md](../decisions/deployment-and-aws.md#the-container-architecture-is-removed-from-the-infrastructure)
records the removal.