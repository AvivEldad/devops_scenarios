# persist-credentials left a GITHUB_TOKEN in a downstream container

## Briefing

`actions/checkout` defaults `persist-credentials: true`, which stores the
`GITHUB_TOKEN` in `.git/config` for later `git push` in the job. A later
step `docker build` with `COPY . .` or a composite that zips the workspace
**packages the token**. Or you checkout into a directory that an untrusted
action reads. Set `persist-credentials: false` unless this job must push,
and never copy `.git` into images.

## Your Task

- Show `.git/config` contains `http.extraheader` with Authorization after
  checkout.
- Set `persist-credentials: false` for jobs that only build/test.
- Add `.git` to `.dockerignore`.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t app .
      - run: docker run --rm app cat /app/.git/config || true
```

### file: Dockerfile

```dockerfile
FROM alpine
COPY . /app
WORKDIR /app
```

## Expected Failure

```text
.git/config contains:
[http]
  extraheader = AUTHORIZATION: basic <base64 token>
The image and any artifact of the workspace can steal repo write
(if token permissions allow).
```

Default token permissions may be read, still a repo clone credential.

## Expected Outcome

Build jobs cannot find a token in `.git`; docker context excludes `.git`.

```yaml
- uses: actions/checkout@v4
  with:
    persist-credentials: false
```

```dockerignore
.git
```

`docker run ... cat /app/.git/config` fails or has no extraheader.

## Hints

### Hint 1 — persist-credentials is for git in later steps

If you `git push` in this job, you need it (or an explicit token env). Test
jobs do not. Reusable workflows that only compile should disable it.

### Hint 2 — Extraheader vs url

Checkout uses an extraheader so the token does not sit in the remote URL.
It still sits on disk. `git config --unset-all http.extraheader` after
checkout is a belt-and-suspenders if you cannot disable persist.

## Solution

```yaml
- uses: actions/checkout@v4
  with:
    persist-credentials: false
    fetch-depth: 1
```

`.dockerignore` includes `.git`.

- **`actions/checkout` in a job that then uses a compromised third-party
  action** is a token theft path — pin SHAs, least `permissions`.
- **Self-hosted runners** keep workspaces longer; leftover `.git/config`
  from a previous job is a real incident class. Ephemeral VMs help.
- **`GITHUB_TOKEN` is per-job** and expires; still treat leaked logs/images
  as urgent.
- **Release jobs** that push tags: enable persist only on that job,
  `contents: write` only there.
