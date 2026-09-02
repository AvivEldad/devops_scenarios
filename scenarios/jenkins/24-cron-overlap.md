# The nightly job that misses runs and doubles up

## Briefing

A nightly job scheduled with `cron('0 2 * * *')` sometimes does not run at all, and
sometimes two instances run at once during a busy period. A weekly report scheduled the
same way runs at slightly different times on different Jenkins controllers, which the
team finds alarming.

Two separate issues: no protection against overlapping runs, and a misunderstanding of
how Jenkins schedules and of the `H` symbol.

## Your Task

- Configure the timer trigger and observe overlap when a run takes longer than expected.
- Prevent concurrent runs of the same job.
- Use `H` correctly to spread load and understand why fixed times are discouraged.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    triggers {
        // fixed minute: every job with 0 2 fires at exactly 02:00, all at once
        cron('0 2 * * *')
    }

    // no disableConcurrentBuilds - a slow run can overlap the next trigger

    stages {
        stage('Nightly') {
            steps {
                sh 'echo "nightly run starting"; sleep 5; echo "done"'
            }
        }
    }
}
```

## Expected Failure

If a nightly run runs long (or is triggered manually near 02:00), a second run starts
while the first is active:

```
#40  Started by timer          (still running)
#41  Started by timer          (started while #40 runs)
```

Two instances hit the same database, same lock, same output path. And every job using
`0 2 * * *` across the controller fires at exactly 02:00, creating a load spike; the
report job "running at different times" is because someone used `H` on one controller and
a fixed minute on another.

## Expected Outcome

Runs never overlap, and load is spread.

Concurrent builds of the job are prevented:

```groovy
options { disableConcurrentBuilds() }
```

A second trigger while one runs is queued or dropped, not run in parallel:

```
#40  Started by timer          (running)
#41  (queued - waiting for #40 to finish)     or coalesced
```

The schedule uses `H` so the exact minute is job-stable but spread across the window:

```groovy
triggers { cron('H 2 * * *') }   // some minute in the 02:00 hour, consistent per job
```

The job still runs about once a day at roughly the intended time.

## Hints

### Hint 1 — `disableConcurrentBuilds` stops overlap

```groovy
options { disableConcurrentBuilds() }
```

This ensures only one build of the job runs at a time; a new trigger waits. Add
`abortPrevious: true` if the newest run should win instead. For cross-job mutual exclusion
(two different jobs touching one resource), use the `lock()` step from Lockable Resources.

### Hint 2 — Use `H` instead of fixed minutes

`H` is a hash based on the job name: a fixed but distributed value. `H 2 * * *` runs at
the same minute every day for a given job, but different jobs get different minutes, so
they do not all fire at 02:00. Fixed minutes (`0 2`) create thundering-herd load spikes.

`H/15 * * * *` means every 15 minutes at a hash-offset; `H H(0-6) * * *` is a good nightly
window.

## Solution

No overlap protection and a fixed schedule minute. Fix both.

```groovy
pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    triggers {
        // consistent per-job minute within the 02:00 hour, spread across jobs
        cron('H 2 * * *')
    }

    stages {
        stage('Nightly') {
            steps {
                sh 'echo "nightly run starting"; sleep 5; echo "done"'
            }
        }
    }
}
```

For a resource shared across different jobs:

```groovy
stage('Nightly') {
    steps {
        lock(resource: 'nightly-database') {
            sh './nightly.sh'
        }
    }
}
```

- **`disableConcurrentBuilds()` prevents a job overlapping itself.** Without it, a slow run
  and the next trigger collide on shared state — the classic double-run corruption.
- **`lock()` handles cross-job exclusion.** Different jobs contending for one database or
  deploy target need a named lock, which `disableConcurrentBuilds` (same-job only) does not
  provide.
- **`H` spreads scheduled load and is deterministic per job.** Prefer it over fixed minutes
  everywhere; `0 2 * * *` on many jobs is a self-inflicted load spike, and the varying
  times people worry about are just `H` doing its job correctly.
- **Timer triggers can be missed** if the controller is down at the scheduled moment;
  Jenkins does not run missed timers on startup. Critical schedules should be monitored, or
  driven by an external scheduler that retries.
