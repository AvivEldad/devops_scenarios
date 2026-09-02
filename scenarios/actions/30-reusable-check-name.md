# The reusable workflow could not write checks, so the PR stayed yellow

## Briefing

A required status is produced by a reusable workflow in a **central**
`.github` repo. The check never appears on the PR, or appears as a workflow
run in the callee repo. `GITHUB_TOKEN` in the callee posts checks to the
**callee** repository unless you pass a token from the caller / use
`actions/checkout` with the caller context. `permissions: checks: write` on
the wrong repo is a common "merge blocked, CI is green elsewhere" incident.

## Your Task

- See a `uses: org/workflows/.github/workflows/ci.yml@v1` run that does not
  attach the required check to the **caller** PR.
- Fix permissions and `checks: write` on the caller, or post the check
  explicitly with the caller `github` context.
- Align the required check **name** with what actually posts.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
# in the APPLICATION repo (caller)
name: CI
on: pull_request
jobs:
  call:
    uses: myorg/platform/.github/workflows/pytest.yml@v1
```

### file: notes.md

```text
platform repo pytest.yml runs on ubuntu-latest and succeeds.
Application PR: required check "test" expected, never received.
Actions tab of application repo shows a "CI" run that is a reusable
workflow wrapper; the inner job name may not be "test".
```

## Expected Failure

```text
Branch protection: Required status check "test" has not reported
Inner job is named "pytest" in the platform repo
GITHUB_TOKEN in the callee cannot create check runs on the caller
```

Green in platform Actions; yellow on the app PR.

## Expected Outcome

The application PR shows a successful required check with the exact name in
the ruleset.

```yaml
# caller
jobs:
  call:
    permissions:
      checks: write
      contents: read
      id-token: write   # if needed
    uses: myorg/platform/.github/workflows/pytest.yml@v1
    secrets: inherit
```

Callee job `name: test` (or ruleset updated to `pytest`). GitHub documents
that reusable workflow **job names** on the caller are `call` / nested;
required checks for reusable workflows often use the **caller job id**
(`call`) or a Check Run you create explicitly.

## Hints

### Hint 1 — What name does the ruleset wait for?

Open a PR that ran CI the old way (in-repo workflow) and copy the check
name from the checks list. Reusable workflows change the name. Put that
string in the ruleset, not the name you remember.

### Hint 2 — Token audience

A token from `myorg/platform` does not post to `myorg/app` unless it is a
PAT/GitHub App installation on the app repo. Prefer in-repo workflows for
required checks, or a GitHub App.

## Solution

Keep required CI in the **application** repo (thin `uses:` with a job name
that matches protection), or create a Check Run with an app token scoped to
the caller.

```yaml
# caller ci.yml
jobs:
  test:
    uses: myorg/platform/.github/workflows/pytest.yml@v1
```

Ruleset requires `test`.

- **Reusable workflows are easy to over-centralise.** Required checks are
  per-repo UX; name them in the caller.
- **`workflow_call` outputs** can feed a caller step that uses
  `actions/github-script` to `createCheckRun` — extra moving parts.
- **Org rulesets** with "require workflow from org" is another model;
  still verify the check name on a real PR.
- **When in doubt, click the yellow check** — GitHub tells you the expected
  name vs received names.
