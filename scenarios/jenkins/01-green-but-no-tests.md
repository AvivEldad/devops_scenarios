# The build is green and the tests never ran

## Briefing

`payments-api` has had a green pipeline for six weeks. This morning a null pointer
reached production in a code path that has a unit test covering it — a test that has
been failing locally for a month.

The pipeline runs the test command. The build says `SUCCESS`. Jenkins shows no test
results tab, which nobody found strange because it has never shown one.

Three small decisions in this `Jenkinsfile` combine to make failure impossible to
report. Every one of them was added by someone trying to make the build "more
reliable".

> You need a Jenkins instance where you can create a Pipeline job. A local container
> is fine:
> `docker run -p 8080:8080 -v jenkins_home:/var/jenkins_home jenkins/jenkins:lts-jdk17`
> Then install the Pipeline and JUnit plugins from the suggested set.

## Your Task

Create a Pipeline job that uses the starter `Jenkinsfile`, run it, and see it pass
while doing nothing useful.

1. Prove the tests are failing but the build is green.
2. Find all three reasons failure is being suppressed.
3. Fix the pipeline so a failing test fails the build, the results are published, and
   the failure is visible without opening the console log.

Do not modify the tests to make them pass. They are supposed to fail — that is the
signal you are trying to restore.

## Starter Files

### file: tests/test_payments.py

```python
def test_charge_amount():
    assert charge(100) == 100


def test_refund_is_negative():
    # this one genuinely fails: the implementation returns a positive number
    assert refund(50) == -50


def charge(amount):
    return amount


def refund(amount):
    return amount
```

### file: requirements.txt

```text
pytest==8.2.0
```

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Setup') {
            steps {
                sh '''
                    python3 -m venv .venv
                    .venv/bin/pip install -q -r requirements.txt
                '''
            }
        }

        stage('Test') {
            steps {
                sh '.venv/bin/pytest tests/ || true'
            }
        }

        stage('Build') {
            steps {
                echo 'building artifact'
            }
        }
    }

    post {
        always {
            echo 'pipeline finished'
        }
        success {
            echo 'ALL GOOD'
        }
    }
}
```

## Expected Failure

Run the job. It goes green:

```
[Pipeline] stage (Test)
============================= test session starts ==============================
collected 2 items

tests/test_payments.py .F                                                [100%]

=================================== FAILURES ===================================
___________________________ test_refund_is_negative ____________________________
    assert refund(50) == -50
E   assert 50 == -50
=========================== 1 failed, 1 passed in 0.04s ========================

[Pipeline] stage (Build)
building artifact
[Pipeline] echo
ALL GOOD
Finished: SUCCESS
```

`1 failed` in the log and `Finished: SUCCESS` twelve lines later. There is no test
results trend on the job page, no failing test listed, and nothing an email or Slack
notification could pick up on. The only way to know is to read the console output of
a build that claims it succeeded, which nobody does.

## Expected Outcome

A failing test must fail the build, and the result must be visible without reading
logs.

The build result is `FAILURE`:

```
Finished: FAILURE
```

The `Build` stage did **not** run. Confirm in the stage view that it is skipped, or
in the log:

```bash
# the console must not contain:
building artifact
```

Test results are published and Jenkins shows the count. On the build page you should
see a **Test Result** link reporting `1 failure` out of `2 tests`, and clicking the
failing test shows `test_refund_is_negative` with its assertion output.

The JUnit XML actually exists as an archived artefact:

```
reports/junit.xml
```

Now fix the implementation so the test passes:

```python
def refund(amount):
    return -amount
```

Re-run. The build is green **and** the test report shows `2 tests, 0 failures`:

```
Finished: SUCCESS
```

Finally, verify the build fails for the right reason if the test command itself
cannot run. Temporarily break the path:

```groovy
sh '.venv/bin/pytest tests-does-not-exist/ --junitxml=reports/junit.xml'
```

The build must fail rather than pass with an empty report — an empty test report is
not a passing test run.

## Hints

### Hint 1 — `|| true` is the whole first problem

```groovy
sh '.venv/bin/pytest tests/ || true'
```

Jenkins decides whether a `sh` step failed by looking at the exit code of the shell.
`|| true` guarantees the shell exits `0` no matter what pytest did.

This idiom exists because someone wanted the pipeline to continue to a later step
that publishes results. That is a real need, and there is a correct way to express
it — but `|| true` throws away the information entirely rather than deferring it.

### Hint 2 — Nothing is publishing test results

pytest printed its failure to stdout and produced no machine-readable output, so
Jenkins has nothing to record. Ask pytest for JUnit XML:

```bash
pytest tests/ --junitxml=reports/junit.xml
```

then publish it in the pipeline with the `junit` step. Once you do, Jenkins tracks
results over time, shows which test failed, and — importantly — **marks the build
unstable or failed based on the report**, independently of exit codes.

### Hint 3 — Use post conditions, not a trailing `|| true`

The correct way to "always publish results even when tests fail" is to let the step
fail and put the publishing in a `post` block:

```groovy
stage('Test') {
    steps {
        sh '.venv/bin/pytest tests/ --junitxml=reports/junit.xml'
    }
    post {
        always {
            junit 'reports/junit.xml'
        }
    }
}
```

`post { always { ... } }` runs whether the stage passed or failed, so you get the
report *and* the failure.

### Hint 4 — The `success` block is lying

```groovy
post {
    success { echo 'ALL GOOD' }
}
```

This is not itself a bug, but it is why the pipeline is so convincing. Once exit
codes propagate correctly it will stop firing on failed builds. Add a `failure`
block too, so an unsuccessful run announces itself.

Consider also `unstable` — the `junit` step marks a build **UNSTABLE** (yellow) rather
than **FAILED** (red) when tests fail, which is the Jenkins convention: red means the
build broke, yellow means the code is broken. Decide which you want and configure it
explicitly.

### Hint 5 — Guard against the empty report

`junit` fails the build if the report is missing, which is good. But a test run that
collected zero tests can produce a valid, empty report and look like success.

```groovy
junit allowEmptyResults: false, testResults: 'reports/junit.xml'
```

`allowEmptyResults: false` is the default, and it is what turns "no tests ran" into a
failure instead of a pass.

## Solution

Three suppression mechanisms stacked on top of each other: the exit code was
discarded, no results were published, and the only reporting was a `success` block
that could not distinguish outcomes.

```groovy
pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 15, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    stages {
        stage('Setup') {
            steps {
                sh '''
                    set -euo pipefail
                    python3 -m venv .venv
                    .venv/bin/pip install -q -r requirements.txt
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                    set -euo pipefail
                    mkdir -p reports
                    .venv/bin/pytest tests/ --junitxml=reports/junit.xml
                '''
            }
            post {
                always {
                    junit allowEmptyResults: false, testResults: 'reports/junit.xml'
                    archiveArtifacts artifacts: 'reports/junit.xml', allowEmptyArchive: true
                }
            }
        }

        stage('Build') {
            steps {
                echo 'building artifact'
            }
        }
    }

    post {
        failure {
            echo "BUILD FAILED: ${env.BUILD_URL}"
        }
        unstable {
            echo "TESTS FAILED: ${env.BUILD_URL}testReport/"
        }
        success {
            echo 'ALL GOOD'
        }
    }
}
```

Run it and the failing test now stops the pipeline before `Build`, publishes a
report, and shows up on the job page as a test failure with a name.

The concepts underneath, which transfer to any CI system:

- **Exit codes are the contract.** Jenkins, GitLab CI, GitHub Actions and every other
  runner decide pass or fail from the exit status of the shell they invoked. Anything
  that alters that status — `|| true`, `set +e`, a trailing `exit 0`, catching an
  exception without rethrowing — is a deliberate decision to hide failure, whether or
  not the author meant it that way.
- **`set -euo pipefail` inside every `sh` block.** Jenkins runs `sh` with
  `/bin/sh -xe` by default, which is *not* the same as bash with pipefail. A failing
  command inside a pipeline within your script can still exit zero, exactly as in the
  Bash scenario on this topic.
- **`post` conditions are the right tool for cleanup and reporting.** `always` for
  publishing and cleanup, `failure` and `unstable` for notification, `cleanup` for
  workspace disposal. Using them removes every legitimate reason to write `|| true`.
- **`timeout` in `options`.** Not related to this bug, but a pipeline with no timeout
  will eventually hang and hold an executor indefinitely. Add it to every job.

If you genuinely need a step to continue on error while still recording that it
failed, the honest expressions are:

```groovy
// mark the build unstable but keep going
catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
    sh './flaky-integration-suite.sh'
}

// or capture the status deliberately
def status = sh(script: './check.sh', returnStatus: true)
if (status != 0) { unstable("check.sh returned ${status}") }
```

Both keep the information. `|| true` destroys it.

## What You Learned

Six weeks of green builds came from three reasonable-looking lines, and the failure
was printed in full in every single one of those builds. The information was never
missing — it was just never turned into a signal anyone would see.

The rule worth carrying into any pipeline you inherit: find every place the exit code
is modified and ask what it is hiding. `|| true`, `continue-on-error`,
`allow_failure`, `ignoreErrors` and their equivalents are all the same decision, and
each one needs a justification written next to it. A pipeline that cannot fail is not
a pipeline; it is a scheduled script with a green light attached.
