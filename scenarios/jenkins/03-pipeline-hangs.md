# The pipeline that never finishes

## Briefing

At 02:14 the nightly `platform-release` pipeline started. It is still running. It is
now 11:00 the next morning, it holds three executors, and every other job on the
controller is queued behind it.

Nobody wants to abort it because it might be "nearly done". The stage view shows two
parallel branches at 60%, and a third that started and has produced no output for
nine hours.

There are four faults here. One causes the hang, two make it impossible to recover
from automatically, and one guarantees the next run will be blocked even after you
kill this one.

> Needs a Jenkins instance with at least two executors so the parallel stages actually
> run concurrently. The Lockable Resources plugin is used in the solution; install it,
> or read that part as reference.

## Your Task

Create the job, run it, and watch it wedge.

1. Identify which construct is blocking, and why it will never resolve on its own.
2. Fix the pipeline so it cannot hang indefinitely under any circumstance.
3. Make it recover cleanly: no leaked lock, no leaked workspace, no held executor.
4. Ensure a subsequent run is not blocked by the wreckage of a previous one.

You may not solve this by asking a human to abort stuck builds. Unattended pipelines
must terminate on their own.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                sh 'echo building; sleep 2'
                sh 'touch /tmp/release.lock'
            }
        }

        stage('Verify') {
            parallel {
                stage('Integration tests') {
                    steps {
                        sh './run-integration.sh'
                    }
                }

                stage('Security scan') {
                    steps {
                        sh './run-scan.sh'
                    }
                }

                stage('Manual approval') {
                    steps {
                        input message: 'Promote this build to production?',
                              ok: 'Promote'
                    }
                }
            }
        }

        stage('Release') {
            steps {
                sh 'echo releasing'
                sh 'rm -f /tmp/release.lock'
            }
        }
    }
}
```

### file: run-integration.sh

```bash
#!/usr/bin/env bash
# Talks to a service that is currently unreachable, with no timeout.
echo "connecting to integration environment..."
curl -sS http://integration.invalid:9999/health
echo "integration tests complete"
```

### file: run-scan.sh

```bash
#!/usr/bin/env bash
echo "scanning..."
sleep 5
echo "scan complete"
```

## Expected Failure

Run the job. Two things happen and neither of them ends.

The `Manual approval` branch posts an input prompt and waits. Forever. Nobody is
awake at 02:14, so the parallel block cannot complete, and because the whole `Verify`
stage is one unit, the pipeline cannot proceed.

Meanwhile `Integration tests` is stuck in `curl` against a host that does not resolve
or does not answer, with no connect timeout and no maximum time, so it will sit there
until the TCP stack gives up — which for some failure modes is effectively never.

```
[Verify] [Integration tests] connecting to integration environment...
[Verify] [Security scan] scan complete
[Verify] [Manual approval] Input requested
```

Nine hours later the log is unchanged. Now abort the build and try to run it again:

```
[Build] + touch /tmp/release.lock
```

The lock file from the aborted run is still on disk. The `Release` stage that removes
it never ran. Nothing in this pipeline checks for it — but the real release tooling
does, so the next run will refuse to promote, and you will spend the morning working
out why a job that reports success produced no release.

## Expected Outcome

The pipeline must terminate on its own and leave nothing behind.

An unattended run finishes with a definite result within a bounded time:

```
Finished: FAILURE       (or ABORTED)
```

and the total duration is close to your configured timeout, not open-ended. Check the
build page: `Took 10 min` rather than `Took 9 hr 4 min`.

The hanging network call is bounded. Its stage fails with a real error:

```
curl: (28) Failed to connect to integration.invalid port 9999 after 10000 ms
```

The approval does not block the automated path. An unattended run must reach a
conclusion without human input — either by skipping approval outside of an
interactive context, or by timing out into a defined state:

```
Timeout set to expire in 15 min
Cancelling nested steps due to timeout
```

No executor is held after the build ends:

```
# Manage Jenkins -> Nodes: all executors idle
```

No lock is leaked, whether the build succeeded, failed, or was aborted:

```bash
# on the agent, after any outcome
ls /tmp/release.lock 2>/dev/null || echo "lock released"
```

Consecutive runs are not blocked. Abort a build mid-flight, then immediately start
another and confirm it completes normally rather than tripping over leftovers.

And a genuinely healthy run still succeeds:

```bash
# point run-integration.sh at something reachable
sed -i 's|http://integration.invalid:9999/health|https://example.com|' run-integration.sh
```

```
Finished: SUCCESS
```

## Hints

### Hint 1 — `input` inside `parallel` blocks everything

The `input` step suspends the pipeline until a human responds. Placed inside a
`parallel` block, it holds the entire block open, and the stage cannot complete until
every branch does.

Worse, on most configurations an `input` inside a `node` context **holds the
executor** while it waits. Nine hours of a blocked prompt is nine hours of a build
slot unavailable to every other job.

Two correct patterns:

- Put `input` **outside** any `node`/`agent` block so it waits without consuming an
  executor.
- Give it a timeout so it cannot wait forever:

```groovy
timeout(time: 30, unit: 'MINUTES') {
    input message: 'Promote?', ok: 'Promote'
}
```

### Hint 2 — Distinguish automated runs from interactive ones

A nightly build should never ask a human anything. Gate the approval on how the build
was triggered:

```groovy
stage('Approval') {
    when {
        beforeAgent true
        expression { currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause') }
    }
    steps {
        timeout(time: 30, unit: 'MINUTES') {
            input message: 'Promote?', ok: 'Promote'
        }
    }
}
```

Think about what the *right* behaviour is for an unattended trigger: usually build and
test everything, then stop before the promotion step rather than waiting on it.

### Hint 3 — Timeouts belong at three levels

One timeout is not enough, because each level protects against a different failure:

- **The whole pipeline**, in `options`, so no build can ever run forever:
  `options { timeout(time: 60, unit: 'MINUTES') }`
- **Individual slow stages**, so one wedged step fails fast instead of consuming the
  entire pipeline budget.
- **The command itself.** `curl --connect-timeout 10 --max-time 60`, and for anything
  else, the `timeout` utility: `timeout 300 ./slow-thing.sh`.

Relying only on the outer timeout means you always wait the full hour to learn that a
step failed in the first thirty seconds.

### Hint 4 — Aborts do not run your cleanup steps

The `rm -f /tmp/release.lock` in the `Release` stage is ordinary pipeline code, so it
never executes when the build is aborted or fails earlier. This is the same defect as
the Bash trap scenario, in a different language.

`post` blocks are Jenkins' equivalent of a trap:

```groovy
post {
    always  { /* publish results */ }
    cleanup { /* release resources, delete workspace */ }
}
```

`cleanup` runs last, after all other post conditions, regardless of outcome —
including on abort.

### Hint 5 — A file is not a lock, and a per-agent file is worse

`/tmp/release.lock` fails as a mutex for the same reason as in the Bash scenario:
test-then-create is not atomic. It also lives on one agent's filesystem, so two builds
on two different agents will not see each other's lock at all.

For cross-build mutual exclusion, Jenkins has the Lockable Resources plugin:

```groovy
lock(resource: 'production-release', inversePrecedence: true) {
    // only one build in the whole controller may be here at a time
}
```

The lock is held by the build and released automatically when it ends, however it
ends. Alternatively `options { disableConcurrentBuilds() }` prevents two runs of the
*same job* overlapping, which is simpler when that is all you need.

## Solution

Four faults: a blocking `input` inside a parallel block, no timeouts at any level, no
cleanup on abnormal exit, and a lock mechanism that is neither atomic nor shared.

```groovy
pipeline {
    agent any

    options {
        timestamps()
        // nothing may run longer than this, ever
        timeout(time: 60, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    stages {
        stage('Build') {
            steps {
                sh 'set -euo pipefail; echo building; sleep 2'
            }
        }

        stage('Verify') {
            parallel {
                stage('Integration tests') {
                    options { timeout(time: 15, unit: 'MINUTES') }
                    steps {
                        sh './run-integration.sh'
                    }
                }

                stage('Security scan') {
                    options { timeout(time: 20, unit: 'MINUTES') }
                    steps {
                        sh './run-scan.sh'
                    }
                }
            }
        }

        // approval is sequential, gated on an interactive trigger, and bounded
        stage('Approval') {
            when {
                beforeAgent true
                expression {
                    currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')
                }
            }
            // agent none: waits without holding an executor
            agent none
            steps {
                timeout(time: 30, unit: 'MINUTES') {
                    input message: 'Promote this build to production?', ok: 'Promote'
                }
            }
        }

        stage('Release') {
            when {
                expression {
                    currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')
                }
            }
            steps {
                // a real, controller-wide mutex, released automatically
                lock(resource: 'production-release') {
                    sh 'set -euo pipefail; echo releasing'
                }
            }
        }
    }

    post {
        aborted {
            echo "ABORTED after ${currentBuild.durationString}"
        }
        failure {
            echo "FAILED: ${env.BUILD_URL}"
        }
        cleanup {
            // runs on success, failure, and abort
            sh 'rm -f /tmp/release.lock || true'
            cleanWs()
        }
    }
}
```

And bound the network call at its source:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "connecting to integration environment..."
curl -sS --fail \
     --connect-timeout 10 \
     --max-time 120 \
     --retry 3 --retry-delay 5 --retry-connrefused \
     "${INTEGRATION_URL:-http://integration.invalid:9999/health}"
echo "integration tests complete"
```

The layered reasoning, which is the part worth keeping:

- **Every wait needs a bound, at every layer.** The pipeline timeout is the backstop,
  the stage timeout localises the failure, and the command timeout gives you the
  fastest, most specific error. A build that has been running for nine hours means all
  three were missing.
- **Human input is not a build step.** It is a gate between builds. Keep it out of
  `parallel`, keep it off an executor with `agent none`, bound it with a timeout, and
  skip it entirely for automated triggers.
- **`post { cleanup { } }` is the only cleanup that survives an abort.** Anything you
  acquire — locks, temp files, cloud resources, feature-flag overrides — must be
  released there and nowhere else.
- **Use a real mutex.** `lock()` from Lockable Resources is held by the build and
  released by Jenkins, so an abort cannot leak it. `disableConcurrentBuilds()` covers
  the simpler same-job case.
- **`--retry-connrefused` with bounded retries** distinguishes a service that is
  starting up from one that is down, without turning a five-second failure into an
  unbounded wait.

A note on aborts you may meet in practice: a `sh` step that ignores `SIGTERM` will not
die when you abort the build, and Jenkins will report the build as aborted while the
process keeps running on the agent. If you see orphaned processes after aborts, that
is why — and it is another argument for running builds inside containers, where the
whole container can be killed.

## What You Learned

The pipeline could not finish because it was waiting for a person who was asleep and a
service that was gone, and it had no mechanism to give up on either. Everything else
followed from that: held executors, a queue backing up, and a leaked lock that would
have broken the next run too.

The generalisable rule for anything unattended is that every wait must be bounded and
every acquisition must be released in a handler that runs on abnormal exit. If you can
answer "what happens if this never responds?" and "what happens if this is killed
right here?" for each step, you will not write a pipeline that hangs — and those two
questions are worth asking of every scheduled job you own, not just this one.
