# The parameters that are not there on the first build

## Briefing

A team adds parameters to a job — an environment choice and a version string. The first
build after the change ignores them entirely and uses empty values. The second build
onward works.

This is a well-known Jenkins behaviour: parameter definitions declared in the pipeline
only take effect after a build has run once to register them.

## Your Task

- Add the parameters, run the job, and observe the first run using empty/default values.
- Understand why the first run behaves differently.
- Make the pipeline safe on the very first run, with sensible defaults.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    parameters {
        choice(name: 'ENVIRONMENT', choices: ['staging', 'production'], description: 'target')
        string(name: 'VERSION', description: 'version to deploy')
    }

    stages {
        stage('Deploy') {
            steps {
                sh 'echo "deploying ${VERSION} to ${ENVIRONMENT}"'
            }
        }
    }
}
```

## Expected Failure

Configure the job from this Jenkinsfile and trigger the first build (before Jenkins has
registered the parameters):

```
+ echo "deploying  to "
deploying  to
```

Both parameters are empty. On the first run, the `parameters {}` block has not yet been
applied to the job configuration, so no values — not even defaults — are available. From
the second build the "Build with Parameters" option appears and values populate.

## Expected Outcome

Even the first run behaves predictably.

Defaults are present regardless of build number:

```
+ echo "deploying 0.0.0 to staging"
deploying 0.0.0 to staging
```

Subsequent parameterised builds use the chosen values:

```
# Build with Parameters -> VERSION=2.4.1, ENVIRONMENT=production
deploying 2.4.1 to production
```

The pipeline does not deploy an empty version to an unspecified environment under any
circumstances.

## Hints

### Hint 1 — First-run parameter definitions apply after the run

When parameters are defined in the Jenkinsfile, the first build is what *registers* them.
That first build itself runs without them. This surprises everyone once.

You cannot fully avoid the one-time registration, but you can make the pipeline tolerate
missing values so the first run is harmless.

### Hint 2 — Default with the Elvis operator and validate

Read parameters defensively and fail on invalid input:

```groovy
environment {
    VERSION     = "${params.VERSION ?: '0.0.0'}"
    ENVIRONMENT = "${params.ENVIRONMENT ?: 'staging'}"
}
```

Add a guard so an empty required value stops the deploy rather than shipping nothing:

```groovy
script {
    if (!params.VERSION?.trim()) { error 'VERSION is required' }
}
```

Give `string` parameters a `defaultValue` too, so the UI is pre-filled once registered.

## Solution

The first build registers the parameters and runs without them. Make the pipeline safe
with defaults and validation.

```groovy
pipeline {
    agent any

    parameters {
        choice(name: 'ENVIRONMENT', choices: ['staging', 'production'], description: 'target')
        string(name: 'VERSION', defaultValue: '0.0.0', description: 'version to deploy')
    }

    environment {
        VERSION     = "${params.VERSION ?: '0.0.0'}"
        ENVIRONMENT = "${params.ENVIRONMENT ?: 'staging'}"
    }

    stages {
        stage('Validate') {
            steps {
                script {
                    if (!env.VERSION?.trim() || env.VERSION == '0.0.0') {
                        echo "WARNING: using default version; not a real deploy"
                    }
                }
            }
        }
        stage('Deploy') {
            steps {
                sh 'echo "deploying ${VERSION} to ${ENVIRONMENT}"'
            }
        }
    }
}
```

- **Parameters defined in a Jenkinsfile register on the first run.** The first build has
  no parameter values; design for it rather than being surprised by it.
- **Default every parameter** with `defaultValue` (for `string`/`choice` the first choice
  is the default) and read with `params.X ?: 'fallback'` so code paths never see null.
- **Validate required inputs and `error` on bad ones.** An empty version deploying to an
  unknown environment is exactly the kind of thing a validation stage should stop.
- **`params` is the correct accessor**, not a bare variable. `params.VERSION` is
  unambiguous; a bare `VERSION` can collide with environment variables.
