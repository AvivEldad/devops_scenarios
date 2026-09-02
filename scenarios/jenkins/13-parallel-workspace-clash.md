# Parallel stages overwrite each other's files

## Briefing

A pipeline runs three build variants in parallel to save time. Intermittently one
variant ships with another's binary, and test results are attributed to the wrong
variant. Running the stages sequentially makes the problem vanish.

The parallel branches share one workspace and write to the same filenames. They are
racing on the filesystem.

## Your Task

- Run the parallel build and reproduce the cross-contamination.
- Explain why parallel branches collide.
- Isolate each branch so parallelism is safe.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Build variants') {
            parallel {
                stage('linux') {
                    steps {
                        sh '''
                            echo "linux binary" > artifact.bin
                            sleep 1
                            echo "linux built from $(cat artifact.bin)"
                        '''
                    }
                }
                stage('windows') {
                    steps {
                        sh '''
                            echo "windows binary" > artifact.bin
                            sleep 1
                            echo "windows built from $(cat artifact.bin)"
                        '''
                    }
                }
            }
        }
    }
}
```

## Expected Failure

```
[linux]   linux built from windows binary
[windows] windows built from windows binary
```

Both branches wrote `artifact.bin` in the same workspace. Whichever wrote last wins, and
both `cat` calls read that one file. The linux branch reports a windows binary.

## Expected Outcome

Each branch works in isolation and reads back its own output.

```
[linux]   linux built from linux binary
[windows] windows built from windows binary
```

Running repeatedly gives correct, stable results regardless of timing:

```
# ten runs, each branch always reads its own artifact
```

## Hints

### Hint 1 — Parallel branches share the workspace by default

Branches of a `parallel` block run concurrently in the *same* workspace directory unless
you separate them. Shared filenames mean a data race: last-writer-wins, and reads see
whatever is there.

### Hint 2 — Give each branch its own directory or agent

Cheapest: run each branch in its own subdirectory with `dir()`:

```groovy
stage('linux') {
    steps {
        dir('linux') { sh 'echo "linux binary" > artifact.bin; ...' }
    }
}
```

Stronger: give each branch its own `agent` (a separate node or container), so they do
not share a filesystem at all. Use `stash`/`unstash` to move files between them
deliberately.

## Solution

Parallel branches shared a workspace and clobbered `artifact.bin`. Isolate them.

```groovy
pipeline {
    agent any

    stages {
        stage('Build variants') {
            parallel {
                stage('linux') {
                    steps {
                        dir('build-linux') {
                            sh '''
                                set -euo pipefail
                                echo "linux binary" > artifact.bin
                                sleep 1
                                echo "linux built from $(cat artifact.bin)"
                            '''
                        }
                    }
                }
                stage('windows') {
                    steps {
                        dir('build-windows') {
                            sh '''
                                set -euo pipefail
                                echo "windows binary" > artifact.bin
                                sleep 1
                                echo "windows built from $(cat artifact.bin)"
                            '''
                        }
                    }
                }
            }
        }
    }
}
```

- **Parallel branches share the workspace unless you isolate them.** Any shared filename
  is a race with nondeterministic results — the classic "works sequentially, breaks in
  parallel" symptom.
- **`dir('name')` per branch** is the simplest isolation and enough for most cases.
- **A per-branch `agent`** gives true isolation (separate filesystem) and lets branches
  run on different nodes; move files explicitly with `stash`/`unstash`.
- **Beware shared *external* state too** — the same database, the same cache key, the same
  cloud resource name. Filesystem isolation does not help if two branches write to one
  remote thing.
