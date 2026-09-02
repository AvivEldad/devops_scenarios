# The deploy that cannot be undone

## Briefing

A pipeline deploys by overwriting the running release in place. When a deploy is bad,
there is no way back except to redeploy from a git revert, which takes twenty minutes
while the outage continues. There is no record of what the previous release was.

The pipeline treats deployment as a one-way operation. A safe pipeline keeps the previous
release, records versions, and can roll back in seconds.

## Your Task

- Run the deploy, then simulate a bad release and try to roll back.
- Identify why rollback is impossible with the current design.
- Redesign the deploy so the previous version is retained and rollback is a fast,
  first-class operation.

## Starter Files

### file: deploy.sh

```bash
#!/usr/bin/env bash
# Overwrites the live release in place. No history, no rollback.
set -euo pipefail
VERSION="$1"
RELEASE_DIR="/srv/app"

echo "deploying ${VERSION}"
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"
echo "${VERSION}" > "${RELEASE_DIR}/VERSION"
echo "deployed. live version:"
cat "${RELEASE_DIR}/VERSION"
```

### file: Jenkinsfile

```groovy
pipeline {
    agent any
    parameters {
        string(name: 'VERSION', defaultValue: '', description: 'version to deploy')
    }
    stages {
        stage('Deploy') {
            steps {
                sh "./deploy.sh ${params.VERSION}"
            }
        }
    }
}
```

## Expected Failure

Deploy a good version, then a bad one:

```
deploy.sh 2.4.0   -> live version: 2.4.0
deploy.sh 2.5.0   -> live version: 2.5.0   (bad release)
```

Now try to roll back. There is nothing to roll back to — `rm -rf` destroyed the previous
release, and no record of `2.4.0` remains. The only recovery is to redeploy `2.4.0` from
scratch, if anyone remembers that was the last good version.

## Expected Outcome

Rollback is fast and the previous release is preserved.

Deploys are versioned and the current one is a pointer:

```bash
ls -l /srv/app/releases/     # 2.4.0  2.5.0  ...
ls -l /srv/app/current       # symlink -> releases/2.5.0
```

Rollback switches the pointer, not the files, and is near-instant:

```bash
./deploy.sh rollback
readlink /srv/app/current
# releases/2.4.0        <- previous release, restored in seconds
```

The pipeline records what it deployed and what the previous version was:

```
deploying 2.5.0 (previous: 2.4.0)
```

Old releases are pruned but several are kept for rollback depth:

```bash
ls /srv/app/releases | wc -l
# a small number (e.g. 5), not one and not unbounded
```

## Hints

### Hint 1 — Deploy to a new directory, switch a symlink

The release-directory + symlink pattern makes deploy and rollback atomic and reversible:

```bash
releases/<version>/     # each release in its own directory
current -> releases/<version>   # an atomic symlink swap activates one
```

Deploying is "unpack new release, repoint `current`". Rolling back is "repoint `current`
at the previous release". No files are destroyed on deploy.

### Hint 2 — Record versions and keep a few releases

Capture the outgoing version before switching, so rollback knows the target and logs are
meaningful. Keep the last N releases and prune older ones, so disk is bounded but rollback
depth exists.

## Solution

In-place overwrite made rollback impossible. Use versioned releases and an atomic symlink.

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="/srv/app"
RELEASES="${ROOT}/releases"
CURRENT="${ROOT}/current"
KEEP=5

cmd="${1:?usage: deploy.sh <version> | rollback}"

if [ "$cmd" = "rollback" ]; then
    prev="$(cat "${ROOT}/PREVIOUS" 2>/dev/null || true)"
    [ -n "$prev" ] && [ -d "${RELEASES}/${prev}" ] || { echo "no previous release"; exit 1; }
    current="$(basename "$(readlink "$CURRENT")")"
    ln -sfn "${RELEASES}/${prev}" "$CURRENT"
    echo "$current" > "${ROOT}/PREVIOUS"
    echo "rolled back to ${prev}"
    exit 0
fi

version="$cmd"
mkdir -p "${RELEASES}/${version}"
echo "${version}" > "${RELEASES}/${version}/VERSION"

prev="$(basename "$(readlink "$CURRENT" 2>/dev/null || echo none)")"
ln -sfn "${RELEASES}/${version}" "$CURRENT"     # atomic switch
echo "$prev" > "${ROOT}/PREVIOUS"
echo "deploying ${version} (previous: ${prev})"

# prune old releases, keeping the newest N
ls -1t "${RELEASES}" | tail -n +$((KEEP + 1)) | while read -r old; do
    [ "${RELEASES}/${old}" = "$(readlink "$CURRENT")" ] || rm -rf "${RELEASES:?}/${old}"
done
```

```groovy
pipeline {
    agent any
    parameters {
        string(name: 'VERSION', defaultValue: '', description: 'version, or "rollback"')
    }
    stages {
        stage('Deploy') {
            steps {
                script {
                    if (!params.VERSION?.trim()) { error 'VERSION required (or "rollback")' }
                    sh "./deploy.sh ${params.VERSION}"
                }
            }
        }
    }
}
```

- **A deploy that overwrites in place cannot be undone.** `rm -rf` on the live release
  destroys your only copy of the last good state, turning every bad deploy into a full
  redeploy under outage pressure.
- **Release directories + an atomic symlink** make deploy and rollback fast, reversible and
  atomic. Switching a symlink is instant and cannot leave a half-deployed state the way
  copying files into the live path can.
- **Record the previous version** so rollback is a single, obvious operation, and so logs
  answer "what did this change?".
- **Keep several releases, prune the rest.** Rollback depth costs a little disk; unbounded
  releases cost all of it. A fixed `KEEP` balances both.
- **This is exactly what Kubernetes gives you for free** with Deployment revision history
  and `kubectl rollout undo` — the same principle (keep old ReplicaSets, switch which is
  active), which is a strong argument for deploying that way when you can.
