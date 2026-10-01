-- Creates the application's database user, and is safe to run again.
--
-- Run once per environment by the db-bootstrap task, as the RDS master user, with :app_user set
-- to todolist_<env>. Every statement is idempotent: the role is created only if it is missing,
-- and repeating a GRANT that is already held is a no-op with a NOTICE. A restored database
-- already has the user, so running this on one changes nothing.
--
-- The user has no password. Membership of rds_iam is what makes it log in with an IAM token
-- instead, and USAGE plus CREATE on the public schema is what Liquibase needs to create the
-- enum types and tables -- which it then owns, so the application needs no further grants.

SELECT format('CREATE ROLE %I LOGIN', :'app_user')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec

GRANT rds_iam TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
