# archiveArtifacts finds nothing to archive

## Briefing

A build produces a report and archives it, but the build page shows no artifacts and the
step warns `No artifacts found that match the file pattern`. The file is definitely
created — an earlier step lists it.

The archive pattern is resolved relative to the workspace root, and the file is somewhere
else, or the pattern does not match where it landed.

## Your Task

- Run the pipeline and confirm the file is created but not archived.
- Determine the path the file is actually written to, relative to the workspace.
- Fix the pattern so the artifact is captured.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Report') {
            steps {
                sh '''
                    mkdir -p build/reports
                    echo "coverage 92%" > build/reports/coverage.txt
                    ls -R build
                '''
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'coverage.txt'
        }
    }
}
```

## Expected Failure

```
+ ls -R build
build:
reports
build/reports:
coverage.txt

WARNING: No artifacts found that match the file pattern "coverage.txt".
Configuration error?
```

The file exists at `build/reports/coverage.txt`. The archive pattern `coverage.txt`
matches only a file of that name in the workspace root, which does not exist.

## Expected Outcome

The artifact is archived and appears on the build page.

```
Archiving artifacts
Recording fingerprints
```

The artifact is listed:

```
Build Artifacts:
  build/reports/coverage.txt
```

And a missing report is treated as a failure, not silently ignored — the build should
not go green if the report it promised to produce is absent.

## Hints

### Hint 1 — Patterns are relative to the workspace root

`archiveArtifacts artifacts: 'coverage.txt'` looks for `<workspace>/coverage.txt`. The
file is at `build/reports/coverage.txt`. Use the full relative path or a glob that
reaches it:

```groovy
archiveArtifacts artifacts: 'build/reports/coverage.txt'
// or
archiveArtifacts artifacts: '**/coverage.txt'
```

`**` matches any depth of directories.

### Hint 2 — Make a missing artifact fail

By default a matching-nothing pattern only warns. Turn it into an error so a broken
report step does not pass silently:

```groovy
archiveArtifacts artifacts: 'build/reports/coverage.txt', allowEmptyArchive: false
```

`allowEmptyArchive: false` is the default, but stating it documents the intent — and
combine it with a step that verifies the file exists before archiving.

## Solution

The pattern did not match the file's actual path.

```groovy
pipeline {
    agent any

    stages {
        stage('Report') {
            steps {
                sh '''
                    set -euo pipefail
                    mkdir -p build/reports
                    echo "coverage 92%" > build/reports/coverage.txt
                    test -s build/reports/coverage.txt
                '''
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'build/reports/**', fingerprint: true
        }
    }
}
```

- **Artifact patterns are workspace-relative Ant globs.** Give the full path or use `**`
  to search subdirectories; `coverage.txt` only ever matches the workspace root.
- **`fingerprint: true`** records a hash so you can trace which build produced a given
  artifact and where it was later used — valuable for auditing releases.
- **Do not let a missing artifact pass quietly.** Verify the file exists in the build
  step (`test -s`), and keep `allowEmptyArchive` at its default `false`, so a report step
  that produced nothing fails the build.
- **Archive into the workspace, never to an absolute path.** Artifacts are copied to the
  controller and shown on the build page; a file written outside the workspace is stranded
  on the agent — the same lesson as the agent-portability scenario.
