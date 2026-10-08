#!/usr/bin/env bash
#
# Bring an environment's billable resources up, or take them down.
#
# Tearing down is a parameter change -- `running = false` -- not a `tofu destroy`, so the
# foundation survives and only the things that cost money go away. This script exists because
# that is two pieces of ceremony nobody should have to remember: the right AWS profile, and the
# right value of the right variable. Getting either wrong is quiet rather than loud.
#
# It deliberately does NOT hide the plan. Every run shows what it is about to do and waits for
# an answer, because a script that applies without showing is how an environment gets destroyed
# by muscle memory. What is applied is the saved plan file, so it is exactly what was shown and
# not a second, differently-timed evaluation.
#
#   ./env.sh up qa          create the database, load balancer and service, on the newest release;
#                           migrate the database, then start the backend
#   ./env.sh up prod v1.2.3 the same, on that release; prod always needs one named
#   ./env.sh down qa        destroy them; the VPC, subnets and IAM stay
#   ./env.sh status qa      what the last apply recorded
#   ./env.sh up qa --yes    skip the confirmation, for a workflow
#   ./env.sh db-bootstrap qa   create the application's database user, once per environment
#   ./env.sh migrate qa        run the Liquibase migrations, logged in with IAM
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE

usage() {
    sed -n '3,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit "${1:-1}"
}

# Before the arity check, or asking for help is itself a usage error.
case "${1:-}" in
    help|--help|-h) usage 0 ;;
esac

[[ $# -ge 2 ]] || usage

readonly COMMAND="$1"
readonly ENVIRONMENT="$2"
shift 2

ASSUME_YES="no"
RELEASE=""
for argument in "$@"; do
    case "$argument" in
        --yes|-y) ASSUME_YES="yes" ;;
        v[0-9]*.[0-9]*.[0-9]*)
            [[ "$COMMAND" == "up" && -z "$RELEASE" ]] || usage
            RELEASE="$argument"
            ;;
        *) echo "Unknown option: $argument" >&2; usage ;;
    esac
done
readonly ASSUME_YES

readonly ROOT="${HERE}/environments/${ENVIRONMENT}"
if [[ ! -d "$ROOT" ]]; then
    echo "No such environment: ${ENVIRONMENT}" >&2
    echo "Available: $(cd "${HERE}/environments" && echo */ | tr -d '/')" >&2
    exit 1
fi

# The lifecycle role is the identity for exactly this operation, so `up` and `down` default to
# it -- but respect an AWS_PROFILE that is already set, because someone who has chosen a profile
# means it. `status` deliberately does not: reading what the last apply recorded needs nothing
# but the state bucket, and demanding an MFA-backed role to answer a question is friction with
# no safety behind it.
# Resolve a profile into actual credentials, rather than handing OpenTofu the profile name.
#
# OpenTofu cannot assume a role that requires MFA: its AWS layer has nowhere to ask for the
# code, and fails with "assume role with MFA enabled, but AssumeRoleTokenProvider session
# option not set". The AWS CLI *can* ask, and caches the answer for the life of the session, so
# the CLI does the assuming and passes on the temporary credentials it gets back.
#
# AWS_PROFILE is unset afterwards: leaving it set would have OpenTofu resolve the chain a second
# time and hit the same wall.
export_credentials_for() {
    local profile="$1" credentials

    echo "Resolving AWS profile ${profile} (you may be asked for an MFA code)."

    # stderr is deliberately not redirected -- the MFA prompt arrives on it.
    if ! credentials="$(aws configure export-credentials --profile "$profile" --format env)"; then
        echo "Could not resolve profile ${profile}." >&2
        echo "Check ~/.aws/config, or set AWS_PROFILE to something else." >&2
        exit 1
    fi

    eval "$credentials"
    unset AWS_PROFILE
}

use_lifecycle_profile() {
    local wanted="${AWS_PROFILE:-taskfest-${ENVIRONMENT}-lifecycle}"

    if aws configure list-profiles 2>/dev/null | grep -qx "$wanted"; then
        # export-credentials arrived in AWS CLI 2.13. Without it, fall back to the old behaviour
        # and say what will happen, rather than failing on a missing subcommand.
        if aws configure export-credentials help >/dev/null 2>&1; then
            export_credentials_for "$wanted"
        else
            export AWS_PROFILE="$wanted"
            echo "Using AWS profile ${wanted}." >&2
            echo "Note: this AWS CLI is too old for 'configure export-credentials'." >&2
            echo "If the profile requires MFA, OpenTofu cannot prompt and will fail." >&2
        fi
        return 0
    fi

    # An explicitly chosen profile that does not exist is an error, not something to shrug at.
    if [[ -n "${AWS_PROFILE:-}" ]]; then
        echo "AWS_PROFILE is set to ${AWS_PROFILE}, which is not configured." >&2
        exit 1
    fi

    # Not configured -- which is the normal state until the role exists, since the role is part
    # of the foundation an administrator applies. Exporting it anyway produced "failed to get
    # shared config profile", an error naming something the reader never set up.
    #
    # The stanza below is filled in from the caller's own account rather than left as angle
    # brackets. A snippet someone has to go and look three values up for is a snippet they have
    # to ask about, which is exactly what happened to the version that did.
    local account mfa region source_profile
    account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
    mfa="$(aws iam list-mfa-devices --query 'MFADevices[0].SerialNumber' --output text 2>/dev/null || true)"
    region="$(sed -n 's/^ *region *= *"\([^"]*\)".*/\1/p' "${ROOT}/terraform.tfvars" 2>/dev/null | head -1)"
    source_profile="${AWS_DEFAULT_PROFILE:-default}"

    [[ -n "$account" ]] || account="<account-id>"
    [[ -n "$region" ]] || region="<region>"
    # `--output text` prints None for a null, and a user may genuinely have no MFA device.
    if [[ -z "$mfa" || "$mfa" == "None" ]]; then
        mfa="# no MFA device found -- the lifecycle role requires one"
    fi

    cat >&2 <<NOTE
Note: no AWS profile named ${wanted} is configured, so this runs as whatever
credentials are already active. That is expected before the role exists.

Once it does -- it is created when this environment is applied -- add this to
~/.aws/config so up and down run with least privilege:

  [profile ${wanted}]
  role_arn       = arn:aws:iam::${account}:role/${wanted}
  source_profile = ${source_profile}
  mfa_serial     = ${mfa}
  region         = ${region}

NOTE
}

run_tofu() { tofu -chdir="$ROOT" "$@"; }

# The region, from terraform.tfvars. export_credentials_for passes on credentials but not a
# region, so the AWS CLI calls below name it rather than trusting the CLI's default.
tfvars_region() {
    sed -n 's/^ *region *= *"\([^"]*\)".*/\1/p' "${ROOT}/terraform.tfvars" | head -1
}

# Runs one of the two one-off tasks, waits for it, prints its log and exits with its exit code.
#
# Both exist only while the environment is up -- they point at the database -- so asking for one
# while it is down is answered with that, not with an ECS error about a missing task definition.
# The task runs where the backend will: a public subnet for its outbound calls, and the tasks
# security group, which is the only one the database admits.
run_one_off() {
    local which="$1" family cluster subnets group region task_arn task_id exit_code reason

    if [[ "$(run_tofu output -json db_endpoint 2>/dev/null || echo null)" == "null" ]]; then
        echo "${ENVIRONMENT} is down, so there is no database to ${which}." >&2
        echo "Run './env.sh up ${ENVIRONMENT}' first." >&2
        exit 1
    fi

    case "$which" in
        db-bootstrap) family="$(run_tofu output -raw db_bootstrap_task_family)" ;;
        migrate)      family="$(run_tofu output -raw migrate_task_family)" ;;
    esac
    cluster="$(run_tofu output -raw cluster_name)"
    group="$(run_tofu output -raw tasks_security_group_id)"
    # ["subnet-a","subnet-b"] -> subnet-a,subnet-b, the shape the shorthand below wants.
    subnets="$(run_tofu output -json public_subnet_ids | tr -d '[]" \n')"
    region="$(tfvars_region)"

    task_arn="$(aws ecs run-task --region "$region" --cluster "$cluster" --task-definition "$family" \
        --launch-type FARGATE --started-by env.sh \
        --network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${group}],assignPublicIp=ENABLED}" \
        --query 'tasks[0].taskArn' --output text)"
    task_id="${task_arn##*/}"
    echo "Started ${which} as task ${task_id}; waiting for it to finish."

    # Up to ten minutes, which is the waiter's own limit. Pulling the image is most of it.
    if ! aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task_arn"; then
        echo "Gave up waiting. The task may still be running: ${task_id}" >&2
        exit 1
    fi

    exit_code="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task_arn" \
        --query 'tasks[0].containers[0].exitCode' --output text)"
    reason="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task_arn" \
        --query 'tasks[0].stoppedReason' --output text)"

    echo "--- last lines of its log ---"
    aws logs get-log-events --region "$region" --log-group-name "/ecs/taskfest-${ENVIRONMENT}" \
        --log-stream-name "task/${which}/${task_id}" --limit 40 \
        --query 'events[].[message]' --output text 2>/dev/null || echo "(no log stream -- it never started)"
    echo "---"

    # No exit code at all means the container never ran: an image pull or a secret that could
    # not be fetched. stoppedReason is then the only explanation there is.
    if [[ "$exit_code" == "0" ]]; then
        echo "${which} succeeded."
    else
        echo "${which} failed (exit code ${exit_code}): ${reason}" >&2
        exit 1
    fi
}

# Scales the backend service to its task count and waits until it is serving -- up to ten
# minutes, the waiter's own limit.
start_backend() {
    local cluster service count region

    cluster="$(run_tofu output -raw cluster_name)"
    service="$(run_tofu output -raw backend_service_name)"
    count="$(run_tofu output -raw backend_task_count)"
    region="$(tfvars_region)"

    aws ecs update-service --region "$region" --cluster "$cluster" --service "$service" \
        --desired-count "$count" --query 'service.desiredCount' --output text >/dev/null
    echo "Starting the backend (${count} task(s)); waiting until it is serving."
    if ! aws ecs wait services-stable --region "$region" --cluster "$cluster" --services "$service"; then
        echo "The backend was not stable within ten minutes; see the service's events in the console." >&2
        exit 1
    fi
    echo "The backend is serving."
}

# The backend image `up` starts, by version and digest through the account's ECR cache -- never
# `latest`, which the cache can serve a day stale (#181).
#
# deploy-backend.py decides and builds the reference, so an environment brought up and one
# deployed to name their image the same way: one that is already up keeps what it runs, since
# releases reach it through deploy-backend.yml and its migration check; one that is down starts the
# release named on the command line or, for qa only, the newest final release on origin -- which
# release.yml has already deployed to qa. prod starts only a release someone names.
#
# Every step is checked by hand: this runs inside $(...), where bash 3.2 ignores `set -e`.
release_image() {
    local release="$1" region image

    if [[ -z "$release" && "$ENVIRONMENT" == "qa" ]]; then
        if ! release="$(git -C "$HERE" ls-remote --tags --refs origin 'v*' | sed 's#.*refs/tags/##' \
            | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)" || [[ -z "$release" ]]; then
            echo "Could not find a release tag on origin; name one: ./env.sh up ${ENVIRONMENT} v1.2.3" >&2
            return 1
        fi
    fi

    if ! region="$(tfvars_region)" || [[ -z "$region" ]]; then
        echo "No region in ${ROOT}/terraform.tfvars; not planning." >&2
        return 1
    fi
    if ! image="$(AWS_REGION="$region" python3 "${HERE}/../../.github/scripts/deploy-backend.py" \
        --environment "$ENVIRONMENT" --print-image ${release:+--version "$release"})" || [[ -z "$image" ]]; then
        echo "Could not determine the backend image; not planning." >&2
        return 1
    fi
    echo "$image"
}

# The newest final snapshot of this environment's database, or nothing if there is none.
#
# Teardown destroys the database and leaves a final snapshot; this is the other half, so that a
# down/up cycle keeps the data. The region is read from terraform.tfvars rather than trusted to
# the CLI's default, because export_credentials_for passes on credentials but not a region.
#
# A failed lookup stops the run instead of falling through to an empty database: "the lookup
# was refused" and "there is no snapshot" must not look the same, or a permissions problem
# becomes a fresh database and the data appears to be gone.
newest_final_snapshot() {
    local region snapshot
    region="$(tfvars_region)"

    # The backticks are a JMESPath string literal, not a command substitution, so single quotes
    # are exactly right here.
    # shellcheck disable=SC2016
    if ! snapshot="$(aws rds describe-db-snapshots --region "$region" \
        --db-instance-identifier "taskfest-${ENVIRONMENT}-db" --snapshot-type manual \
        --query 'reverse(sort_by(DBSnapshots[?Status==`available`], &SnapshotCreateTime))[0].DBSnapshotIdentifier' \
        --output text)"; then
        echo "Could not look up the database snapshots for ${ENVIRONMENT}; not planning." >&2
        exit 1
    fi

    # `--output text` prints None for a null.
    [[ "$snapshot" == "None" ]] || echo "$snapshot"
}

case "$COMMAND" in
    status)
        run_tofu init -input=false >/dev/null
        outputs="$(run_tofu output -json 2>/dev/null || echo '{}')"

        # Three states worth telling apart. The middle one is real: an environment applied before
        # the teardown switch existed has a foundation and no record of the switch, and saying
        # "nothing has been applied" about it would be a lie with 22 resources behind it.
        if [[ "$outputs" == *'"running"'* ]]; then
            if [[ "$(run_tofu output -raw running)" == "true" ]]; then
                echo "${ENVIRONMENT}: up -- the billable resources exist."
            else
                echo "${ENVIRONMENT}: down -- foundation only, nothing billable."
            fi
        elif [[ -n "$(run_tofu state list 2>/dev/null)" ]]; then
            echo "${ENVIRONMENT}: applied, but before the teardown switch existed."
            echo "Run './env.sh down ${ENVIRONMENT}' once to record it. Nothing will be destroyed:"
            echo "there are no billable resources yet."
        else
            echo "${ENVIRONMENT}: no state yet; nothing has been applied."
        fi
        ;;

    up|down)
        # These describe the switch being flipped, not an outcome. The earlier wording asserted
        # that resources would be created, and said so before the plan had been computed -- so
        # `up` on an environment with nothing billable yet announced a cost that never came. A
        # warning that is sometimes untrue is one people stop reading, and this one guards an
        # apply.
        if [[ "$COMMAND" == "up" ]]; then
            running="true"
            echo "Planning: bring ${ENVIRONMENT} UP, by setting running = true."
            echo "Anything billable appears in the plan below; that plan is the truth, not this line."
        else
            running="false"
            echo "Planning: take ${ENVIRONMENT} DOWN, by setting running = false."
            echo "Anything billable is destroyed. The foundation -- VPC, subnets, security groups,"
            echo "IAM -- is not touched."
        fi

        use_lifecycle_profile
        run_tofu init -input=false >/dev/null

        # What `up` adds: the release the backend starts as, and the snapshot to restore. The
        # snapshot is only read when the database is created, so passing it to an environment that
        # is already up changes nothing; a newer release there re-registers the task definitions
        # tofu owns, which the service ignores -- deploying is deploy-backend.yml's job. `down`
        # passes neither: nothing it keeps runs an image, and there is nothing to restore into.
        up_args=()
        if [[ "$COMMAND" == "up" ]]; then
            if ! image="$(release_image "$RELEASE")"; then
                exit 1
            fi
            echo "The backend starts as ${image}."
            up_args=(-var "backend_image=${image}")

            snapshot="$(newest_final_snapshot)"
            if [[ -n "$snapshot" ]]; then
                echo "A newly created database is restored from ${snapshot}."
                up_args+=(-var "db_restore_snapshot=${snapshot}")
            else
                echo "No final snapshot of the ${ENVIRONMENT} database exists; a new one starts empty."
            fi
        fi

        # A saved plan, so what gets applied is what was just shown on screen.
        plan_file="$(mktemp -t "tofu-${ENVIRONMENT}")"

        # The output is teed so the one failure with a non-obvious cause can be recognised and
        # explained, rather than every failure getting a guess appended to it.
        plan_log="$(mktemp -t "tofu-${ENVIRONMENT}-log")"
        trap 'rm -f "$plan_file" "$plan_log"' EXIT

        # The odd expansion is for macOS's bash 3.2, where "${up_args[@]}" on an empty array
        # is an unbound-variable error under `set -u`.
        if ! run_tofu plan -input=false -var "running=${running}" ${up_args[@]+"${up_args[@]}"} \
            -out="$plan_file" 2>&1 | tee "$plan_log"; then
            if grep -q "openid_connect_provider" "$plan_log"; then
                cat >&2 <<NOTE

The account-wide root has not been applied. The environments look the GitHub OIDC provider
up by URL, so they cannot plan until it exists:

  tofu -chdir="${HERE}/account" init && tofu -chdir="${HERE}/account" apply

NOTE
            fi
            # IAM is eventually consistent: right after an apply that granted the lifecycle role
            # something, one region can still refuse it. Say how to tell that from a real gap.
            if grep -q -E "AccessDenied|not authorized to perform" "$plan_log"; then
                cat >&2 <<NOTE

AccessDenied. If the role's policy was changed by an apply in the last few minutes, this is
probably IAM still propagating the change to this region -- wait a minute and run again.
To tell that from a permission that is really missing, ask the simulator about the live policy:

  aws iam simulate-principal-policy --policy-source-arn <role arn from the error> \\
    --action-names <action from the error> --resource-arns <resource from the error>

"allowed" means wait and retry; "implicitDeny" means the policy lacks it (lifecycle.tf).
See README.md, "IAM changes take a while to reach every region".

NOTE
            fi
            exit 1
        fi

        if [[ "$ASSUME_YES" != "yes" ]]; then
            read -r -p "Apply this plan to ${ENVIRONMENT}? [y/N] " answer
            [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Nothing applied."; exit 1; }
        fi

        run_tofu apply -input=false "$plan_file"

        # The service was created with no tasks (billable.tf), so nothing has started against a
        # schema it does not expect. Migrate, then start it. On an environment that was already up
        # the migration finds nothing to do -- it runs the image already running -- and the count
        # is what it was.
        if [[ "$COMMAND" == "up" ]]; then
            if [[ -z "$snapshot" ]]; then
                # A database created empty has no application user yet; elsewhere this is a no-op.
                echo "No snapshot to restore from, so the application user is created first."
                run_one_off db-bootstrap
            fi
            run_one_off migrate
            start_backend
        fi
        ;;

    db-bootstrap|migrate)
        use_lifecycle_profile
        run_tofu init -input=false >/dev/null
        run_one_off "$COMMAND"
        ;;

    *)
        echo "Unknown command: ${COMMAND}" >&2
        usage
        ;;
esac
