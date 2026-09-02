# The shared library that will not load

## Briefing

A pipeline calls a helper from the team's shared library — `deployHelper()` — and fails
with `No such DSL method 'deployHelper'`. The library exists, other jobs use it, and the
function is right there in `vars/`.

The library is not being imported, or is imported in a way that does not expose the
function. Shared library loading has specific rules.

## Your Task

- Run the pipeline and reproduce the missing-method error.
- Determine whether the library is loaded and under what name.
- Import it correctly so the helper is callable.

## Starter Files

### file: Jenkinsfile

```groovy
// no @Library annotation, and the library is not configured as "implicitly loaded"
pipeline {
    agent any
    stages {
        stage('Deploy') {
            steps {
                deployHelper(env: 'staging')
            }
        }
    }
}
```

### file: the-library/vars/deployHelper.groovy

```groovy
def call(Map args) {
    echo "deploying to ${args.env}"
}
```

### file: notes.md

```text
Shared library is registered in Manage Jenkins -> System -> Global Pipeline Libraries
  Name:            devops-lib
  Default version: main
  Load implicitly: NO
```

## Expected Failure

```
java.lang.NoSuchMethodError: No such DSL method 'deployHelper' found among steps [...]
Finished: FAILURE
```

The library `devops-lib` is registered but not set to load implicitly, and the
Jenkinsfile never imports it. So `deployHelper` is unknown.

## Expected Outcome

The helper loads and runs.

```
+ deploying to staging
Finished: SUCCESS
```

The library is imported explicitly with a pinned version, and the function is resolved
from `vars/`.

## Hints

### Hint 1 — Import the library explicitly

Unless a library is configured to "Load implicitly", each Jenkinsfile must import it:

```groovy
@Library('devops-lib') _
```

The trailing `_` matters — it is the annotated target. Put this at the very top of the
Jenkinsfile, before `pipeline {`.

### Hint 2 — Pin a version, and know where functions come from

Pin to a branch, tag or commit for reproducibility:

```groovy
@Library('devops-lib@v1.4.0') _
```

Functions in `vars/foo.groovy` become the step `foo()` via their `call()` method.
Classes in `src/` are imported with `import`. A method not found usually means the file
is not in `vars/`, has no `call()`, or the library was never imported.

## Solution

The library was registered but not imported.

```groovy
@Library('devops-lib@main') _

pipeline {
    agent any
    stages {
        stage('Deploy') {
            steps {
                deployHelper(env: 'staging')
            }
        }
    }
}
```

- **`@Library('name') _` imports a non-implicit library.** The `_` is required; omitting
  it, or placing the annotation below `pipeline {`, both fail.
- **`vars/foo.groovy` with a `call()` method becomes the `foo()` step.** That naming
  convention is how the DSL method is exposed; a file elsewhere or without `call()` is not
  callable as a step.
- **Always pin the version** (`@name@tag`). An unpinned `@Library('name')` follows the
  configured default branch, so a change in the library can alter every consuming pipeline
  at once — the same mutable-dependency risk as an unpinned action or image.
- **`library()` step for dynamic loading** exists too, letting you load a library mid-run
  or choose the version at runtime, but the `@Library` annotation is preferred for the
  common case.
