# The 900-line Jenkinsfile nobody dares change

## Briefing

One Jenkinsfile has grown to 900 lines. It defines eight jobs' worth of logic behind
`if` statements on branch names, copy-pastes the same build steps five times with small
variations, and mixes scripted and declarative styles. Every change risks breaking an
unrelated job, so changes have effectively stopped.

The pipeline works. It is unmaintainable, which is its own kind of failure. This scenario
is about refactoring CI code with the same rigour as application code.

## Your Task

- Read the monolith and identify the duplication and the conditional sprawl.
- Extract the repeated logic into a shared library function.
- Reduce the Jenkinsfile to a readable description of what this pipeline does.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'main') {
                        sh 'echo setup; npm ci; npm run build; echo "tag prod"'
                    } else if (env.BRANCH_NAME == 'staging') {
                        sh 'echo setup; npm ci; npm run build; echo "tag staging"'
                    } else if (env.BRANCH_NAME.startsWith('release/')) {
                        sh 'echo setup; npm ci; npm run build; echo "tag rc"'
                    } else {
                        sh 'echo setup; npm ci; npm run build; echo "tag dev"'
                    }
                    // ... the same shape repeats for Test, Scan, Publish, Notify ...
                    // ... 850 more lines ...
                }
            }
        }
    }
}
```

### file: notes.md

```text
The five stages (Build, Test, Scan, Publish, Notify) each contain a near-identical
if/else-if ladder over branch name, differing only in a tag or target string.
```

## Expected Failure

There is no runtime error — that is the point. The failure is maintainability:

```
- 900 lines; the same npm ci; npm run build repeated in every branch of every stage
- a change to the build command must be made in ~20 places
- a typo in one branch of one ladder breaks exactly one job, silently
- nobody can read the file top-to-bottom and say what it does
```

## Expected Outcome

The behaviour is identical, expressed in a fraction of the code.

The Jenkinsfile is short and declarative, and the environment-specific value is data:

```groovy
// the whole pipeline reads as: build, test, scan, publish, notify - for this env
```

The repeated logic lives once, in a shared library:

```
vars/buildApp.groovy       # the build steps, parameterised by target
```

A change to the build command is made in one place:

```
# editing buildApp.groovy changes every job's build step
```

The mapping from branch to target is a lookup, not a ladder:

```groovy
def target = TARGETS.get(env.BRANCH_NAME, 'dev')
```

## Hints

### Hint 1 — Replace the if/else ladder with a data lookup

The ladders differ only by a string. That is a map, not control flow:

```groovy
def TARGETS = ['main': 'prod', 'staging': 'staging']
def target = env.BRANCH_NAME.startsWith('release/') ? 'rc'
           : TARGETS.getOrDefault(env.BRANCH_NAME, 'dev')
```

One expression replaces five copies of a four-branch ladder.

### Hint 2 — Extract repeated steps into a shared library

Move the repeated `npm ci; npm run build; tag` into `vars/buildApp.groovy` with a
`call(Map)` so it becomes a single step:

```groovy
// vars/buildApp.groovy
def call(Map args) {
    sh "echo setup; npm ci; npm run build; echo 'tag ${args.target}'"
}
```

The Jenkinsfile then reads `buildApp(target: target)`. Test the library like code.

## Solution

Duplication and conditional sprawl. Data-drive the target and extract steps to a library.

```groovy
// vars/buildApp.groovy  (shared library)
def call(Map args) {
    sh "npm ci && npm run build && echo 'tag ${args.target}'"
}
```

```groovy
// vars/resolveTarget.groovy
def call(String branch) {
    def map = ['main': 'prod', 'staging': 'staging']
    if (branch?.startsWith('release/')) return 'rc'
    return map.getOrDefault(branch, 'dev')
}
```

```groovy
// Jenkinsfile
@Library('devops-lib@v1.0.0') _

pipeline {
    agent any

    environment {
        TARGET = "${resolveTarget(env.BRANCH_NAME)}"
    }

    stages {
        stage('Build')   { steps { buildApp(target: env.TARGET) } }
        stage('Test')    { steps { testApp(target: env.TARGET) } }
        stage('Scan')    { steps { scanApp(target: env.TARGET) } }
        stage('Publish') { steps { publishApp(target: env.TARGET) } }
        stage('Notify')  { steps { notify(target: env.TARGET) } }
    }
}
```

- **CI code deserves the same engineering as application code.** Duplication, dead
  branches, and mixed styles are technical debt that eventually freezes a pipeline as
  surely as a bug takes it down.
- **Replace conditional ladders over data with data lookups.** When branches differ only by
  a value, that value belongs in a map, not in control flow — one expression instead of
  five near-identical blocks, and one place to change.
- **Shared libraries remove duplication across jobs.** A function in `vars/` is defined once,
  versioned, testable, and reused everywhere — the same build step in twenty places becomes
  one call.
- **Pin the library version** so a refactor to shared code is a deliberate, reviewable
  change rather than something that silently alters every pipeline at once.
- **Keep the Jenkinsfile declarative and readable.** The top-level file should describe
  *what* the pipeline does; the *how* lives in the library. If you cannot read the
  Jenkinsfile top to bottom and understand the flow, it is too complex.
