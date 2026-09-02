# Test results never appear in the trend graph

## Briefing

A pipeline runs a test suite that writes JUnit XML. The build passes and fails
correctly, but the test-results trend graph is empty, individual test failures are not
listed, and you cannot click a failing test to see why.

The tests run, but nothing publishes their results, and when someone adds the `junit`
step it reports "no results" because the path is wrong.

## Your Task

- Run the pipeline and confirm no test results are recorded.
- Make the results publish so the trend graph and per-test view populate.
- Ensure a build with failing tests is marked accordingly, and a run that produced no
  results is treated as a failure.

## Starter Files

### file: run-tests.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p target/test-output
cat > target/test-output/results.xml <<'EOF'
<testsuite name="suite" tests="2" failures="1">
  <testcase name="test_pass"/>
  <testcase name="test_fail"><failure>expected 5 got 4</failure></testcase>
</testsuite>
EOF
echo "tests done"
exit 0
```

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Test') {
            steps {
                sh './run-tests.sh'
                // wrong path, and only runs if the previous step succeeded
                junit 'test-results.xml'
            }
        }
    }
}
```

## Expected Failure

```
+ ./run-tests.sh
tests done
[Pipeline] junit
Recording test results
ERROR: No test report files were found. Configuration error?
```

The results are at `target/test-output/results.xml`; the `junit` step looked for
`test-results.xml` in the workspace root. And because `junit` is a normal step, if the
test script itself had failed, publishing would be skipped entirely — losing the results
exactly when you need them.

## Expected Outcome

Results publish, the failure is reflected, and the trend populates.

The build is marked UNSTABLE (tests failed) and the report is recorded:

```
Recording test results
1 tests failed out of 2
Finished: UNSTABLE
```

The failing test is visible with its message:

```
Test Result -> test_fail -> "expected 5 got 4"
```

Publishing happens even when the test step fails:

```
# make run-tests.sh exit 1 after writing XML; results are STILL published
```

An empty result set fails the build rather than passing silently:

```
# if no XML is produced, the build fails, not succeeds
```

## Hints

### Hint 1 — Point `junit` at the real path, with a glob

```groovy
junit 'target/test-output/*.xml'
```

The pattern is workspace-relative. `**/*.xml` searches all subdirectories if you are
unsure where the framework writes results.

### Hint 2 — Publish in `post`, not inline

If `junit` runs as a normal step after the tests, a failing test command skips it. Put it
in `post { always { } }` so results are recorded regardless of the step's exit status:

```groovy
stage('Test') {
    steps { sh './run-tests.sh' }
    post {
        always {
            junit allowEmptyResults: false, testResults: 'target/test-output/*.xml'
        }
    }
}
```

`allowEmptyResults: false` turns "no results found" into a failure — a test run that
recorded nothing is not a pass.

## Solution

Wrong path and inline publishing. Fix both.

```groovy
pipeline {
    agent any

    stages {
        stage('Test') {
            steps {
                sh './run-tests.sh'
            }
            post {
                always {
                    junit allowEmptyResults: false,
                          testResults: 'target/test-output/*.xml'
                }
            }
        }
    }
}
```

- **`junit` marks the build UNSTABLE when tests fail** and records the report for the
  trend graph and per-test view. It is independent of the shell exit code — which is why
  publishing belongs in `post { always }`, so it runs even when the test step fails.
- **The path is a workspace-relative glob.** Point it where the framework actually writes
  XML; `**/*.xml` is a safe catch-all.
- **`allowEmptyResults: false`** makes an empty report a failure. A suite that produced no
  results usually means it did not run at all — the "green build, no tests" trap from the
  beginner Jenkins scenario, in miniature.
- **UNSTABLE vs FAILURE**: `junit` uses yellow (UNSTABLE) for test failures and red
  (FAILURE) for build breakage, by convention. Decide which your gates should block on.
