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
    local wanted="${AWS_PROFILE:-todolist-${ENVIRONMENT}-lifecycle}"

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
