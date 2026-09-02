# Dependabot PRs cannot read secrets and cannot trigger workflows

## Briefing

Dependabot opens a PR; CI fails on `secrets.NPM_TOKEN` empty, or the
`pull_request` workflow from Dependabot does not start further workflows
(`GITHUB_TOKEN` from `dependabot` has restrictions). People copy
`pull_request_target` to "fix secrets" and create a supply-chain hole (expert
drill). The intermediate fix is: `pull_request` from Dependabot +
`secrets: inherit` on workflows started by `workflow_run`, or repo setting
"Actions → General → Fork pull request workflows from outside collaborators"
— Dependabot is special-cased.

Know **why** the secret is empty before you widen access.

## Your Task

- Explain why `secrets.*` is empty on a Dependabot `pull_request`.
- Use `pull_request` CI that does not need secrets (public packages).
- For private registries, use `dependabot.yml` + org secret access, or
  `workflow_run` on completion of a trusted path — not `pull_request_target`
  with PR checkout.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: ci
on: pull_request
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### file: .github/dependabot.yml

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
```

## Expected Failure

```text
Dependabot PR:
  npm ERR! 401 Unauthorized
  NPM_TOKEN length 0
```

Same workflow on a branch you push: token works.

## Expected Outcome

Public npm: no token. Private: Dependabot has `registries:` in
`dependabot.yml` with its own secret, and CI uses a **non-PR** trusted
workflow for publish only.

```yaml
# ci.yml — no secret for install if using public registry
- run: npm ci
```

```yaml
# dependabot.yml
registries:
  npm-private:
    type: npm-registry
    url: https://npm.pkg.github.com
    token: ${{ secrets.NPM_TOKEN }}
```

(Dependabot secrets are configured in Dependabot secret store, not always
the same as Actions secrets.)

## Hints

### Hint 1 — Dependabot PRs are untrusted like forks

GitHub does not hand Actions secrets to `pull_request` from Dependabot by
default. There is a repo option to enable them — understand the risk (a
malicious dependency bump PR could exfiltrate). Prefer no secrets in that CI.

### Hint 2 — GITHUB_TOKEN on Dependabot

Even if the job runs, `GITHUB_TOKEN` may not trigger subsequent workflows.
`workflow_run` after a successful `pull_request` on `dependabot/**` is the
pattern for trusted follow-up, still without checking out untrusted code in
the privileged workflow.

## Solution

Remove the token from PR CI if possible; configure Dependabot registries
separately; never `pull_request_target` + checkout of the PR for npm ci.

```yaml
- run: npm ci
  # public registry
```

- **`pull_request_target` + `actions/checkout` of `head.sha`** is the classic
  CVE. Expert scenario 22.
- **Actions secrets vs Dependabot secrets** are different settings pages.
- **Group updates** reduce PR volume; they do not grant secrets.
- **Pin GitHub-hosted npm** with `always-auth` only in trusted jobs.
