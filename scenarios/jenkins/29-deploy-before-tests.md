# The pipeline that deploys before the tests finish

## Briefing

A pipeline runs tests and deploys. Occasionally it deploys a build whose tests were still
running or had actually failed. The stages are wired together with manual `build` triggers
and `wait: false`, so the ordering guarantees the author assumed do not exist.

The deploy is not waiting for a real success signal. Fixing it is about making the
pipeline's dependency graph explicit and honest.

## Your Task

- Trace how the current jobs are chained and find where the ordering breaks.
- Explain why `wait: false` and separate jobs lost the dependency.
- Restructure so deploy runs only after tests genuinely pass, with failure propagated.

## Starter Files

### file: ci.Jenkinsfile

```groovy
pipeline {
    agent any
    stages {
        stage('Test') {
            steps {
                sh './run-tests.sh'
                // fire-and-forget: does NOT wait, does NOT check the result
                build job: 'deploy', wait: false
            }
        }
    }
}
```

### file: run-tests.sh

```bash
#!/usr/bin/env bash
echo "running tests..."
sleep 3
echo "TESTS FAILED"
exit 1
```

### file: deploy.Jenkinsfile

```groovy
pipeline {
    agent any
    stages {
        stage('Deploy') {
            steps {
                sh 'echo deploying to production'
            }
        }
    }
}
```

## Expected Failure

```
[ci] running tests...
[ci] (build job: 'deploy', wait: false)  -> deploy triggered immediately
[deploy] deploying to production          <- runs while tests are still going
[ci] TESTS FAILED
[ci] Finished: FAILURE
```

The deploy was triggered before the test result was known, with `wait: false` so its
outcome is not even checked. The tests then failed — but production was already deployed.

## Expected Outcome

Deploy runs only after tests pass, and a test failure prevents it.

On failing tests, deploy never runs:

```
running tests...
TESTS FAILED
Finished: FAILURE
# deploy job was NOT triggered
```

On passing tests, deploy runs after them and its failure fails the pipeline:

```
running tests...
tests passed
deploying to production
Finished: SUCCESS
```

The dependency is explicit — test success is a precondition for deploy, enforced by the
pipeline structure, not by timing.

## Hints

### Hint 1 — `wait: false` discards the ordering and the result

Triggering deploy with `wait: false` means the test job does not wait for deploy and,
more importantly here, deploy was triggered regardless of whether the tests had finished
or passed. The `sh './run-tests.sh'` was still running (or about to fail) when deploy
started.

### Hint 2 — Make stages sequential in one pipeline, or gate the trigger

Simplest: put test and deploy in the same pipeline as sequential stages. A failing stage
stops the pipeline, so deploy only runs if test succeeded:

```groovy
stages {
    stage('Test')   { steps { sh './run-tests.sh' } }
    stage('Deploy') { steps { sh 'echo deploying' } }
}
```

If they must be separate jobs, trigger deploy only after the test step succeeds, with
`wait: true, propagate: true`, so a deploy failure fails the caller too.

## Solution

`wait: false` and split jobs broke the dependency. Make the ordering structural.

```groovy
pipeline {
    agent any

    stages {
        stage('Test') {
            steps {
                sh './run-tests.sh'
            }
        }

        stage('Deploy') {
            // reached only if Test succeeded - a failing stage stops the pipeline
            steps {
                sh 'echo deploying to production'
            }
        }
    }
}
```

If deploy genuinely must be a separate job, gate and wait on it:

```groovy
stage('Test') {
    steps {
        sh './run-tests.sh'                       // fails the stage on non-zero exit
        build job: 'deploy', wait: true, propagate: true   // only reached on success
    }
}
```

- **Sequential stages encode "runs only if the previous succeeded".** A failing stage
  aborts the pipeline, so downstream stages are naturally gated on upstream success — the
  simplest, most reliable way to order test-then-deploy.
- **`wait: false` means fire-and-forget.** The caller neither waits for nor checks the
  triggered job. Never use it for a deploy that depends on the current job's result.
- **`propagate: true` couples outcomes.** When you do split jobs, a failed downstream must
  fail the upstream, or "green" stops meaning "the whole thing worked".
- **Prefer one pipeline for a linear flow.** Splitting test and deploy into separate jobs
  buys little and loses the built-in ordering; reach for separate jobs only when they truly
  have independent lifecycles, and then wire the dependency explicitly.
- **Set exit codes correctly in scripts.** The whole gate rests on `run-tests.sh` exiting
  non-zero on failure — the same discipline as the pipefail and subprocess scenarios.
