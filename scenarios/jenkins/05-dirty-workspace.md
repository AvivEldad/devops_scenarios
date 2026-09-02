# The build that sees last week's files

## Briefing

A packaging job occasionally produces an archive containing files that were deleted
from the repository weeks ago. It is intermittent, and it correlates with which agent
runs the build.

Jenkins reuses the workspace directory for a job on a given agent and does not clean it
between runs. Old build output, stale checkouts and deleted files are all still there.

## Your Task

- Run the job twice, deleting a file between runs, and confirm the deleted file still
  ends up in the artifact.
- Explain why the workspace contains it.
- Make every build start from a known-clean state.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Generate') {
            steps {
                sh '''
                    echo "current build output" > output.txt
                    ls *.txt
                    tar -czf package.tgz *.txt
                '''
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'package.tgz'
        }
    }
}
```

## Expected Failure

Run the job once. Then simulate a previous build having left a file behind, and run
again:

```
+ echo "current build output"
+ ls *.txt
output.txt
stale-from-last-week.txt      <- still here from a prior run
+ tar -czf package.tgz *.txt
```

The `*.txt` glob picked up a file no current build created. The artifact ships with
content nobody put there this time.

```bash
tar -tzf package.tgz
# output.txt
# stale-from-last-week.txt
```

## Expected Outcome

Every build starts clean and the artifact contains only what this build produced.

The workspace has no leftovers at the start:

```
+ ls *.txt
output.txt        <- only the file this build created
```

The artifact is correct:

```bash
tar -tzf package.tgz
# output.txt
```

Running the job repeatedly produces identical, correct artifacts every time:

```
# three consecutive runs, all containing only output.txt
```

## Hints

### Hint 1 — Workspaces are reused and never auto-cleaned

Jenkins keeps a workspace per job per agent and reuses it for speed. Files from previous
runs — and occasionally from a different job that used the same path — persist. A glob
like `*.txt` will happily include them.

### Hint 2 — Clean explicitly

`cleanWs()` (Workspace Cleanup plugin) empties the workspace. Clean before you start, or
in a `post` block after:

```groovy
stage('Prepare') {
    steps {
        cleanWs()
        checkout scm
    }
}
```

Pair it with `options { skipDefaultCheckout(true) }` so you control exactly when the
checkout happens.

## Solution

The workspace carried files from earlier runs into the build.

```groovy
pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
    }

    stages {
        stage('Prepare') {
            steps {
                cleanWs()
                checkout scm
            }
        }
        stage('Generate') {
            steps {
                sh '''
                    set -euo pipefail
                    echo "current build output" > output.txt
                    tar -czf package.tgz output.txt
                '''
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'package.tgz'
        }
        cleanup {
            cleanWs()
        }
    }
}
```

- **Treat the workspace as dirty until you clean it.** Reuse is a performance feature and
  a correctness hazard; when correctness matters, `cleanWs()` explicitly.
- **Prefer naming files over globbing** where you can. `tar output.txt` cannot pick up a
  stray file the way `tar *.txt` can.
- **`post { cleanup { cleanWs() } }`** leaves the agent tidy for the next job and is worth
  adding by default on shared agents where disk fills up.
- **A container agent sidesteps this entirely**, because each build gets a fresh
  filesystem — the same reasoning as the portability scenario.
