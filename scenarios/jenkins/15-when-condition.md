# The stage that never runs, and the one that always does

## Briefing

A deploy stage guarded by `when { branch 'main' }` never runs, even on `main`. A
separate cleanup stage that should only run on failure runs every time.

The `when` conditions are being evaluated against values that are not what the author
assumed, and one condition is in the wrong place to do what it intends.

## Your Task

- Run the pipeline on the `main` branch and confirm the deploy stage is skipped.
- Determine what branch name Jenkins actually sees.
- Fix the conditions so deploy runs on `main` and cleanup runs only on failure.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Deploy') {
            when {
                branch 'origin/main'
            }
            steps {
                sh 'echo deploying'
            }
        }

        stage('Cleanup on failure') {
            // a stage cannot detect "the build failed" from within stages
            when {
                expression { currentBuild.result == 'FAILURE' }
            }
            steps {
                sh 'echo cleaning up after failure'
            }
        }
    }
}
```

## Expected Failure

On a build of the `main` branch:

```
Stage 'Deploy' skipped due to when conditional
+ echo cleaning up after failure
```

Deploy skipped — the branch condition compared against `origin/main`, but the `branch`
directive matches the short name `main`. And cleanup ran on a successful build, because
`currentBuild.result` is `null` (not yet `FAILURE`) during normal execution.

## Expected Outcome

Deploy runs on `main`; cleanup runs only when the build actually fails.

On `main`:

```
+ echo deploying
```

On a non-`main` branch, deploy is skipped. Cleanup does not run on success:

```
# successful build: no "cleaning up after failure" line
```

When a stage genuinely fails, cleanup runs:

```
# failing build: "cleaning up after failure" appears
```

## Hints

### Hint 1 — `branch` matches the short name

`when { branch 'main' }` matches the branch name Jenkins records in `env.BRANCH_NAME`,
which is `main`, not `origin/main`. It also supports globs: `branch 'release/*'`.

For non-multibranch jobs `env.BRANCH_NAME` may be unset — check with `echo env.BRANCH_NAME`
and use `when { expression { env.GIT_BRANCH == 'origin/main' } }` if that is the value you
actually have.

### Hint 2 — Failure handling belongs in `post`, not `when`

A stage cannot reliably ask "did the build fail?" while the build is still running —
`currentBuild.result` is `null` until something sets it. Cleanup-on-failure is what the
`post { failure { } }` block is for:

```groovy
post {
    failure { sh 'echo cleaning up after failure' }
}
```

## Solution

Wrong branch string, and failure logic in the wrong construct.

```groovy
pipeline {
    agent any

    stages {
        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                sh 'echo deploying'
            }
        }

        stage('Build') {
            steps {
                sh 'echo building'
            }
        }
    }

    post {
        failure {
            sh 'echo cleaning up after failure'
        }
        always {
            echo "result: ${currentBuild.currentResult}"
        }
    }
}
```

- **`when { branch }` matches the short branch name** (`main`), from `env.BRANCH_NAME`.
  Print the variable when unsure; the value differs between multibranch and single-branch
  jobs.
- **`post` conditions are how you react to outcome**: `success`, `failure`, `unstable`,
  `aborted`, `always`, `cleanup`. `when` decides whether a stage *runs*, not what happens
  after the build resolves.
- **`currentBuild.currentResult` vs `currentBuild.result`**: `result` is `null` until set;
  `currentResult` gives the running status (`SUCCESS` so far). Neither is a substitute for
  a `post { failure }` block.
- **`beforeAgent true` in `when`** skips allocating an agent for a stage that will be
  skipped — worth adding to save executor time on conditional stages.
