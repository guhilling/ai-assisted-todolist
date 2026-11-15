#!/usr/bin/env bash
#
# Apply an environment, or the account-wide root, as an administrator.
#
# There is nothing to bring up or take down any more: since #557 an environment is the Go
# backend's functions, its table and the distribution in front of them, which bill per request and
# are always there. What is left is the ceremony an apply needs and nobody should have to
# remember: the right AWS profile, its MFA code asked for by the AWS CLI, and the plan shown first.
#
# It deliberately does NOT hide the plan. Every run shows what it is about to do and waits for
# an answer, because a script that applies without showing is how an environment gets destroyed
# by muscle memory. What is applied is the saved plan file, so it is exactly what was shown and
# not a second, differently-timed evaluation.
#
#   ./env.sh up qa          plan qa's root (environments/qa), then apply it once confirmed
#   ./env.sh up prod        the same for prod
#   ./env.sh account        the same for the account-wide root (account/)
#   ./env.sh up qa --yes    skip the confirmation
#
# The profile is TASKFEST_<ENV>_AWS_PROFILE (TASKFEST_QA_AWS_PROFILE, TASKFEST_ACCOUNT_AWS_PROFILE,
# ...) or else AWS_PROFILE, and must be an administrator's that assumes a role.
#
# up, down, status, migrate and db-bootstrap were the container architecture's, which is in the
# tag pre-serverless (doc/decisions/deployment-and-aws.md). They stop with a note now.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly HERE

usage() {
    sed -n '3,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit "${1:-1}"
}

# Before the arity check, or asking for help is itself a usage error.
case "${1:-}" in
    help|--help|-h) usage 0 ;;
esac

# The container architecture's commands, retired with it (#557). Loudly, rather than by doing
# something else under a name people have in their fingers: `down` destroyed what billed by the
# hour, and nothing does now. `up` stays, for what is left: applying the environment's root, still
# under the name the plan-only hook asks about first.
case "${1:-}" in
    down|status|migrate|db-bootstrap)
        cat >&2 <<NOTE
'$1' is gone, with the container architecture it was for (#557). Nothing was planned or applied.

An environment no longer goes up or down: the Go backend bills per request and is always there.
To apply an environment's configuration, as an administrator:

  ./env.sh up ${2:-<qa|prod>}

The containers, the load balancer and the database are in the tag pre-serverless.
NOTE
        exit 1
        ;;
esac

# `account` names no environment: it is the account-wide root (account/), applied once per AWS
# account and before either environment.
if [[ "${1:-}" == "account" ]]; then
    COMMAND="account"
    ENVIRONMENT="account"
    shift
else
    [[ $# -ge 2 ]] || usage
    COMMAND="$1"
    ENVIRONMENT="$2"
    shift 2
fi
readonly COMMAND ENVIRONMENT

[[ "$COMMAND" == "up" || "$COMMAND" == "account" ]] || {
    echo "Unknown command: ${COMMAND}" >&2
    usage
}

ASSUME_YES="no"
for argument in "$@"; do
    case "$argument" in
        --yes|-y) ASSUME_YES="yes" ;;
        *) echo "Unknown option: $argument" >&2; usage ;;
    esac
done
readonly ASSUME_YES

if [[ "$COMMAND" == "account" ]]; then
    readonly ROOT="${HERE}/account"
else
    readonly ROOT="${HERE}/environments/${ENVIRONMENT}"
fi
if [[ ! -d "$ROOT" ]]; then
    echo "No such environment: ${ENVIRONMENT}" >&2
    echo "Available: $(cd "${HERE}/environments" && echo */ | tr -d '/')" >&2
    exit 1
fi

# The variable naming this root's profile: TASKFEST_QA_AWS_PROFILE, TASKFEST_ACCOUNT_AWS_PROFILE.
profile_variable() {
    echo "TASKFEST_$(echo "$ENVIRONMENT" | tr '[:lower:]-' '[:upper:]_')_AWS_PROFILE"
}

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
        echo "Check ~/.aws/config, or set $(profile_variable) to something else." >&2
        exit 1
    fi

    eval "$credentials"
    unset AWS_PROFILE
}

# Whether a profile assumes a role -- a role_arn, or an SSO role -- rather than being an IAM user
# itself. Read from the configuration only; nothing is signed.
assumes_a_role() {
    [[ -n "$(aws configure get role_arn --profile "$1" 2>/dev/null)" ||
       -n "$(aws configure get sso_role_name --profile "$1" 2>/dev/null)" ]]
}

# The profile for this root, and what chose it: TASKFEST_<ENV>_AWS_PROFILE first, so a person can
# name one per root in their shell's startup file without it being overridden by a global
# AWS_PROFILE; then AWS_PROFILE. There is no default: every apply here is an administrator's, and
# there is no profile name to guess. Prints "<profile> <source>".
chosen_profile() {
    local variable value
    variable="$(profile_variable)"
    value="${!variable:-}"
    if [[ -n "$value" ]]; then
        echo "$value $variable"
    elif [[ -n "${AWS_PROFILE:-}" ]]; then
        echo "$AWS_PROFILE AWS_PROFILE"
    else
        echo "- none"
    fi
}

# The command that runs this again with a profile named, for the notes below.
again_with_profile() {
    if [[ "$COMMAND" == "account" ]]; then
        echo "$(profile_variable)=<your admin profile> $0 account"
    else
        echo "$(profile_variable)=<your admin profile> $0 up ${ENVIRONMENT}"
    fi
}

use_admin_profile() {
    local wanted source profiles
    read -r wanted source <<< "$(chosen_profile)"
    if [[ "$source" == "none" ]]; then
        cat >&2 <<NOTE
${ENVIRONMENT} is applied by an administrator, and there is no default profile for it.
Name yours in $(profile_variable) (in your shell's startup file, say), or for one run:

  $(again_with_profile)
NOTE
        exit 1
    fi
    # The lifecycle roles went with the container architecture (#557), so a startup file that still
    # names one would fail late, with an AccessDenied or a role that cannot be assumed.
    if [[ "$wanted" == *-lifecycle ]]; then
        cat >&2 <<NOTE
${wanted} (from ${source}) is a lifecycle role's profile,
and those roles were removed with the container architecture (#557).
An apply is an administrator's: point ${source} at your admin profile, or for one run:

  $(again_with_profile)
NOTE
        exit 1
    fi

    # Read once and searched afterwards: `aws configure list-profiles | grep -q` under pipefail
    # fails now and then, when grep stops at its match and the CLI dies of the closed pipe.
    profiles="$(aws configure list-profiles 2>/dev/null || true)"

    if ! grep -qx "$wanted" <<< "$profiles"; then
        echo "${source} is set to ${wanted}, which is not configured." >&2
        exit 1
    fi

    # A profile that is the IAM user itself -- one that may assume every role -- holds none of the
    # roles' permissions, and failed with a bare 403 on the state bucket. Stop and say why instead.
    if ! assumes_a_role "$wanted"; then
        cat >&2 <<NOTE
The AWS profile ${wanted} (from ${source}) assumes no role: it has no role_arn and no SSO role, so
it is an IAM user's own credentials, and those may not touch ${ENVIRONMENT}'s state or resources --
being allowed to assume a role is not having its permissions.

Use an administrator's profile that assumes a role, by naming it in $(profile_variable)
(in your shell's startup file, say), or for one run:

  $(again_with_profile)
NOTE
        exit 1
    fi

    # export-credentials arrived in AWS CLI 2.13. Without it, fall back to the old behaviour and
    # say what will happen, rather than failing on a missing subcommand.
    if aws configure export-credentials help >/dev/null 2>&1; then
        export_credentials_for "$wanted"
    else
        export AWS_PROFILE="$wanted"
        echo "Using AWS profile ${wanted}." >&2
        echo "Note: this AWS CLI is too old for 'configure export-credentials'." >&2
        echo "If the profile requires MFA, OpenTofu cannot prompt and will fail." >&2
    fi
}

run_tofu() { tofu -chdir="$ROOT" "$@"; }

if [[ "$COMMAND" == "account" ]]; then
    echo "Planning the account-wide root."
else
    echo "Planning ${ENVIRONMENT}."
fi

use_admin_profile
run_tofu init -input=false >/dev/null

# A saved plan, so what gets applied is what was just shown on screen.
plan_file="$(mktemp -t "tofu-${ENVIRONMENT}")"

# The output is teed so the one failure with a non-obvious cause can be recognised and explained,
# rather than every failure getting a guess appended to it.
plan_log="$(mktemp -t "tofu-${ENVIRONMENT}-log")"
trap 'rm -f "$plan_file" "$plan_log"' EXIT

if ! run_tofu plan -input=false -out="$plan_file" 2>&1 | tee "$plan_log"; then
    if [[ "$COMMAND" == "up" ]] && grep -q "openid_connect_provider" "$plan_log"; then
        cat >&2 <<NOTE

The account-wide root has not been applied. The environments look the GitHub OIDC provider
up by URL, so they cannot plan until it exists:

  $0 account

NOTE
    fi
    exit 1
fi

if [[ "$ASSUME_YES" != "yes" ]]; then
    read -r -p "Apply this plan to ${ENVIRONMENT}? [y/N] " answer
    [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Nothing applied."; exit 1; }
fi

run_tofu apply -input=false "$plan_file"
