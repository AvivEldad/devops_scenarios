# The action tag moved and CI started shipping malware-shaped code

## Briefing

`uses: actions/checkout@v4` (or a third-party `@master`) is a **moving tag**.
The tag can be force-pushed. GitHub now warns and offers immutable SHA pins.
A compromised publisher or a hijacked tag runs in your privileged jobs with
`GITHUB_TOKEN`. Pinning `uses: actions/checkout@<full-sha>` and commenting
the version is the supply-chain baseline (also in actions-03). This drill is
the tag-move incident itself.

## Your Task

- Replace floating tags with commit SHAs for third-party actions.
- Use Dependabot `github-actions` ecosystem to update SHAs.
- Prefer GitHub-owned actions over random `@master`.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: some-org/some-action@master
      - uses: docker/login-action@v3
```

## Expected Failure

```text
some-org/some-action@master resolved to commit abc today
and commit def tomorrow after a force-push
No review, no SHA change in your repo
```

Your git history still says `@master`. You cannot tell what ran without the
run log's resolved SHA.

## Expected Outcome

Third-party (and ideally all) actions are pinned.

```yaml
- uses: actions/checkout@9aefc6034f877d7c6dc7f0e1d0f7b0c0c0c0c0c0 # v4.2.2
- uses: docker/login-action@9780b0c442f0e4e5c5c0c0c0c0c0c0c0c0c0c0c0 # v3.3.0
# some-org/some-action removed or pinned + reviewed
```

Dependabot opens PRs that change the SHA and the comment.

## Hints

### Hint 1 — The run log shows the resolved SHA

Open a past run → the step expands to a 40-char SHA. That is what actually
ran. Copy it into the YAML.

### Hint 2 — Immutable releases

GitHub is rolling out immutable action tags. Until every action you use
supports that, SHA pin. `actions/checkout@v4.2.2` is still a tag (better than
`v4`, not as good as SHA).

## Solution

Pin SHAs; add Dependabot:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- **Your own composite action at `@main`** is the same risk if that repo is
  writable by many people. Pin a release tag you control, then SHA in
  consumers.
- **`workflow_call` `@main`** is a mutable workflow, same class.
- **Review Dependabot action updates** like dependency updates — read the
  changelog.
- **Post-compromise:** assume all secrets used in jobs that ran the bad SHA
  are burned.
