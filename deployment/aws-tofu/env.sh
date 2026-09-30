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
#   ./env.sh up qa          create the database, load balancer and service
#   ./env.sh down qa        destroy them; the VPC, subnets and IAM stay
#   ./env.sh status qa      what the last apply recorded
#   ./env.sh up qa --yes    skip the confirmation, for a workflow
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE

usage() {
    sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
for argument in "$@"; do
    case "$argument" in
        --yes|-y) ASSUME_YES="yes" ;;
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
use_lifecycle_profile() {
    # Already chosen: someone who sets AWS_PROFILE means it.
    [[ -z "${AWS_PROFILE:-}" ]] || return 0

    local wanted="todolist-${ENVIRONMENT}-lifecycle"

    if aws configure list-profiles 2>/dev/null | grep -qx "$wanted"; then
        export AWS_PROFILE="$wanted"
        echo "Using AWS profile ${wanted} (set AWS_PROFILE to override)."
        return 0
    fi

    # Not configured -- which is the normal state until the role exists, since the role is part
    # of the foundation an administrator applies. Exporting it anyway produced "failed to get
    # shared config profile", an error naming something the reader never set up.
    cat >&2 <<NOTE
Note: no AWS profile named ${wanted} is configured, so this runs as whatever
credentials are already active. That is expected before the role exists.

Once it does, add this to ~/.aws/config so up and down run with least privilege:

  [profile ${wanted}]
  role_arn       = <the lifecycle_role_arn output of environments/${ENVIRONMENT}>
  source_profile = default
  mfa_serial     = arn:aws:iam::<account>:mfa/<your-user>

NOTE
}

run_tofu() { tofu -chdir="$ROOT" "$@"; }

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
        if [[ "$COMMAND" == "up" ]]; then
            running="true"
            echo "Planning: bring ${ENVIRONMENT} UP (creates resources that cost money)."
        else
            running="false"
            echo "Planning: take ${ENVIRONMENT} DOWN (destroys the database, load balancer and service)."
            echo "The foundation -- VPC, subnets, security groups, IAM -- is not touched."
        fi

        use_lifecycle_profile
        run_tofu init -input=false >/dev/null

        # A saved plan, so what gets applied is what was just shown on screen.
        plan_file="$(mktemp -t "tofu-${ENVIRONMENT}")"

        # The output is teed so the one failure with a non-obvious cause can be recognised and
        # explained, rather than every failure getting a guess appended to it.
        plan_log="$(mktemp -t "tofu-${ENVIRONMENT}-log")"
        trap 'rm -f "$plan_file" "$plan_log"' EXIT

        if ! run_tofu plan -input=false -var "running=${running}" -out="$plan_file" 2>&1 | tee "$plan_log"; then
            if grep -q "openid_connect_provider" "$plan_log"; then
                cat >&2 <<NOTE

The account-wide root has not been applied. The environments look the GitHub OIDC provider
up by URL, so they cannot plan until it exists:

  tofu -chdir="${HERE}/account" init && tofu -chdir="${HERE}/account" apply

NOTE
            fi
            exit 1
        fi

        if [[ "$ASSUME_YES" != "yes" ]]; then
            read -r -p "Apply this plan to ${ENVIRONMENT}? [y/N] " answer
            [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Nothing applied."; exit 1; }
        fi

        run_tofu apply -input=false "$plan_file"
        ;;

    *)
        echo "Unknown command: ${COMMAND}" >&2
        usage
        ;;
esac
