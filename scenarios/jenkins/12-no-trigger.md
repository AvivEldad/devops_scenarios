# Pushes to the repo do not trigger a build

## Briefing

A pipeline exists and runs fine when triggered manually. Nobody's commits start a build
automatically. Developers push, wait, and eventually click "Build Now" out of habit.

The job has no working trigger configured. There are two common ways to fix it, and one
of them fails silently if a piece of infrastructure is missing.

## Your Task

- Confirm the job only runs on manual trigger.
- Add a trigger so commits start builds.
- Understand the difference between SCM polling and a webhook, and when each fails.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    // no triggers block - nothing starts this job automatically

    stages {
        stage('CI') {
            steps {
                sh 'echo "building ${GIT_COMMIT}"'
            }
        }
    }
}
```

## Expected Failure

Push commits to the repository. Nothing happens. The build history shows only entries
`Started by user ...`, never `Started by an SCM change` or
`Started by GitHub push by ...`.

There is no trigger, so Jenkins has no reason to build. It does not watch the repository
by default.

## Expected Outcome

Commits start builds automatically.

The build history shows automated triggers:

```
#12  Started by GitHub push by alice
#11  Started by an SCM change
```

The commit that triggered the build is the one that gets built:

```
+ echo "building a1b2c3d..."
```

Manual builds still work, and the pipeline does not build in a loop or on every poll
regardless of changes.

## Hints

### Hint 1 — Two mechanisms, different trade-offs

- **SCM polling** (`pollSCM`): Jenkins periodically asks the repository whether anything
  changed. Simple, works anywhere, but adds latency and load, and polls even when idle.

```groovy
triggers { pollSCM('H/5 * * * *') }
```

- **Webhook** (`githubPush`, or a generic webhook): the repository notifies Jenkins on
  push. Instant and efficient, but requires the repo to be able to reach Jenkins and a
  webhook to be configured on the repo side.

### Hint 2 — Webhooks fail silently if the repo cannot reach Jenkins

If you configure `githubPush()` but the GitHub webhook is missing, points at the wrong
URL, or cannot reach a Jenkins behind a firewall, nothing triggers and nothing errors.
Check the webhook's recent deliveries on the repository side. Polling is the reliable
fallback when Jenkins is not reachable from the internet.

## Solution

The job had no trigger. Add one — polling as the portable default, or a webhook where the
repo can reach Jenkins.

```groovy
pipeline {
    agent any

    triggers {
        // portable: Jenkins checks every ~5 minutes, builds only on change
        pollSCM('H/5 * * * *')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    stages {
        stage('CI') {
            steps {
                sh 'echo "building ${GIT_COMMIT}"'
            }
        }
    }
}
```

Prefer a webhook when possible, keeping poll as a safety net:

```groovy
triggers {
    githubPush()
    pollSCM('H/30 * * * *')   // fallback if a webhook delivery is missed
}
```

- **Jenkins does not watch your repo unless told to.** No `triggers` block means the job
  only ever runs on a manual or upstream trigger.
- **Webhooks are instant; polling is reliable.** Use webhooks where the repository can
  reach Jenkins, and keep a low-frequency poll as a backstop for missed deliveries.
- **`H` in cron spreads load.** `H/5 * * * *` means "every 5 minutes, but at a
  hash-chosen offset" so all jobs do not poll on the same tick.
- **A silent webhook is the classic trap.** When "the webhook is configured but nothing
  triggers", check the delivery log on the repository side — the request may never be
  reaching Jenkins at all.
- **Multibranch Pipelines** handle this more cleanly for repos with many branches,
  discovering branches and PRs and triggering per-branch automatically.
