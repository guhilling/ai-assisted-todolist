# Review guidance for TaskFest

TaskFest is a demo task list: a Quarkus backend (Java 25), a React + TypeScript frontend, PostgreSQL,
and AWS infrastructure in OpenTofu. Pull requests are mostly written by an AI agent and reviewed by
a person. Review them as a second pair of eyes, and prefer a few concrete, verified findings over
many speculative ones. Say what breaks and under which input or state.

## What matters most here

- **Correctness and security first:** ownership checks (a user only ever sees and changes their own
  tasks and files; someone else's answers like a missing one), presigned S3 links, concurrency
  between the database and S3, and anything that could lose or expose a user's data.
- **Tests come first and existing tests are not edited without the owner's consent.** Flag a change
  to an existing test's assertions or setup, a deleted test, or a skipped one, unless the pull
  request says it was agreed.
- **No real email addresses** in code, fixtures or docs. Only reserved domains (`example.com`,
  `example.org`) are fine. The one allowed real address is the obscured contact
  `demo-apps[at]hilling.de`.
- **No secrets** of any kind.
- **The API contract is generated.** `doc/api/` and `frontend/src/generated/` must never be edited by
  hand; a change there without a matching backend change is a finding.
- **Documentation lives in `/doc` and changes with the behaviour it describes.** Behaviour changed
  without its page, or a page now saying something untrue, is a finding.

## Conventions worth checking

- Backend: every public type has a Javadoc block saying what it is *for*; a GET runs a constant
  number of SQL statements; enums are native PostgreSQL enums; no `java.lang.System` in production
  code; no `TODO:` comments (to-dos are issues).
- Frontend: no user-visible text written in a component (it comes from `src/i18n/messages.ts`, in
  English and German); `api.ts` is the only module that calls `fetch`; components take data and
  callbacks.
- Infrastructure is **OpenTofu**, not Terraform. The two environment roots under
  `deployment/aws-tofu/environments/` must stay identical apart from `terraform.tfvars`; every
  resource belongs in `modules/environment/`. Infrastructure is applied by a person, never by CI.

## Please don't

- Comment on formatting that Checkstyle, oxlint or `tofu fmt` already enforce.
- Suggest `Optional` in records that go over the wire (it breaks the OpenAPI schema), or a
  hand-written type the generator already provides.
- Ask for more comments where the code is clear; the project prefers fewer, purposeful ones.
