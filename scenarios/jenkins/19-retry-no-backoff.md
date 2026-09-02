# The retry that hammers a flaky step to death

## Briefing

An integration step occasionally fails because a downstream service is briefly
unavailable. Someone wrapped it in `retry(100)`. Now when the service is genuinely down,
the pipeline retries a hundred times with no pause, holds an executor for an hour, and
adds load to the very service that is struggling.

Retrying is right; retrying like this is not. There is no backoff, no timeout, and no
distinction between a transient failure and a permanent one.

## Your Task

- Run the step against a failing dependency and watch it retry relentlessly.
- Explain why unbounded, immediate retries make an outage worse.
- Replace it with bounded retries, backoff, and a timeout.

## Starter Files

### file: flaky.sh

```bash
#!/usr/bin/env bash
# Simulates a dependency that is currently down.
echo "calling integration service..."
exit 1
```

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Integration') {
            steps {
                // no backoff, no timeout, absurd count
                retry(100) {
                    sh './flaky.sh'
                }
            }
        }
    }
}
```

## Expected Failure

```
+ ./flaky.sh
calling integration service...
+ ./flaky.sh
calling integration service...
+ ./flaky.sh
...
(100 times, back to back, in a few seconds, then fails)
```

The retries fire instantly with no delay, so a permanently-down service is called a
hundred times in seconds. If each call were slower, this would hold an executor for a
very long time, and it adds a burst of load to a struggling dependency.

## Expected Outcome

Retries are bounded, spaced out, and time-limited.

A transient failure recovers within a few attempts; a permanent one fails promptly with
a bounded number of attempts:

```
+ ./flaky.sh      (attempt 1)
[waiting 5s]
+ ./flaky.sh      (attempt 2)
[waiting 10s]
+ ./flaky.sh      (attempt 3)
Integration failed after 3 attempts
```

The stage cannot run indefinitely — a timeout caps total time:

```
Timeout set to expire in 10 minutes
```

And a genuinely healthy dependency passes on the first try with no delay.

## Hints

### Hint 1 — Bound the count and add backoff

A handful of attempts is almost always enough to ride out a blip; a hundred is not
"more reliable", just louder. Add a growing delay between attempts so you are not
hammering:

```groovy
retry(3) {
    sh './flaky.sh'
    // or use a helper that sleeps with increasing backoff between tries
}
```

`waitUntil` or a small scripted loop gives you exponential backoff if `retry` alone is
too blunt.

### Hint 2 — Always cap total time with `timeout`

Wrap the retrying block so it cannot run forever, and put a `--max-time` on the actual
network call so a single attempt cannot hang:

```groovy
timeout(time: 10, unit: 'MINUTES') {
    retry(3) { sh 'curl --max-time 30 ... || exit 1' }
}
```

## Solution

Unbounded, immediate retries with no timeout. Bound them, back off, and cap the time.

```groovy
pipeline {
    agent any

    options {
        timeout(time: 20, unit: 'MINUTES')
    }

    stages {
        stage('Integration') {
            options {
                timeout(time: 10, unit: 'MINUTES')
            }
            steps {
                script {
                    int attempts = 0
                    retry(3) {
                        attempts++
                        if (attempts > 1) {
                            sleep(time: 5 * (attempts - 1), unit: 'SECONDS') // 0, 5, 10s
                        }
                        sh './flaky.sh'
                    }
                }
            }
        }
    }
}
```

- **Retry counts should be small.** Three to five attempts absorb almost all transient
  failures; large counts just prolong and amplify an outage.
- **Back off between attempts.** Immediate retries add load exactly when the dependency
  can least handle it. A growing delay gives it time to recover and is gentler on it.
- **Cap total time with `timeout`**, at the stage and the pipeline, and bound each
  individual call with the tool's own timeout (`curl --max-time`). Retry without timeout
  can still hang forever on one slow attempt.
- **Distinguish retryable from fatal.** A 503 is worth retrying; a 400 or an auth failure
  is not — retrying a permanent error is wasted time. Where you can, only retry on the
  errors that can succeed later.
- **`catchError`/`unstable`** is the honest way to let a flaky non-critical step fail
  without failing the build, instead of pretending it passed.
