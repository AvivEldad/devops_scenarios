# The downstream job that ignores the version you passed

## Briefing

An upstream build triggers a downstream deploy and passes it a `VERSION` parameter. The
downstream job always deploys `latest` instead of the version handed to it.

The `build` step is triggering the job but not passing parameters the way the downstream
job reads them, and the downstream job's own default is masking the problem.

## Your Task

- Run the upstream job and confirm the downstream deploys the wrong version.
- Determine how parameters must be passed to a triggered job.
- Pass the version correctly and confirm the downstream uses it.

## Starter Files

### file: upstream.Jenkinsfile

```groovy
pipeline {
    agent any
    stages {
        stage('Trigger deploy') {
            steps {
                script {
                    def version = '2.4.1'
                    // parameters not passed; the downstream uses its default
                    build job: 'deploy'
                }
            }
        }
    }
}
```

### file: downstream.Jenkinsfile

```groovy
pipeline {
    agent any
    parameters {
        string(name: 'VERSION', defaultValue: 'latest', description: 'version to deploy')
    }
    stages {
        stage('Deploy') {
            steps {
                sh 'echo "deploying ${VERSION}"'
            }
        }
    }
}
```

## Expected Failure

Upstream run:

```
Scheduling project: deploy
```

Downstream run:

```
+ echo "deploying latest"
```

The upstream computed `2.4.1` but never passed it. The downstream fell back to its
`defaultValue` of `latest`, so nothing errored — it just deployed the wrong thing.

## Expected Outcome

The downstream deploys the version the upstream chose.

Downstream run:

```
+ echo "deploying 2.4.1"
```

The parameter is passed explicitly, and the upstream waits for (or deliberately does not
wait for) the downstream as intended, propagating failure if the deploy fails.

## Hints

### Hint 1 — Pass parameters in the `build` step

```groovy
build job: 'deploy',
      parameters: [string(name: 'VERSION', value: version)]
```

The `parameters` list must use the binding types matching the downstream's parameter
definitions (`string`, `booleanParam`, `choice` via `string`, etc.). Without it, the
downstream uses its own defaults.

### Hint 2 — Control waiting and failure propagation

`build` waits for the downstream by default and fails the upstream if the downstream
fails — usually what you want. Set `wait: false` for fire-and-forget, and
`propagate: false` if a downstream failure should not fail the upstream (then inspect the
returned result object).

## Solution

The trigger passed no parameters, so the downstream used its default.

```groovy
// upstream
pipeline {
    agent any
    stages {
        stage('Trigger deploy') {
            steps {
                script {
                    def version = '2.4.1'
                    def result = build job: 'deploy',
                        parameters: [string(name: 'VERSION', value: version)],
                        wait: true,
                        propagate: true
                    echo "downstream result: ${result.result}"
                }
            }
        }
    }
}
```

- **Triggered jobs do not inherit the caller's variables.** Pass everything explicitly via
  `parameters:`; a downstream with defaults will silently use them otherwise, which is how
  the wrong version reaches production without an error.
- **Match the parameter binding types** to the downstream's `parameters {}` definitions,
  and the names exactly.
- **`wait` and `propagate` are the two levers.** Default (`wait: true, propagate: true`)
  couples the jobs so a failed deploy fails the trigger. `propagate: false` requires you
  to check `result.result` yourself.
- **A dangerous default beats a loud failure only in appearance.** `defaultValue: 'latest'`
  turned a missing-parameter bug into a wrong-deploy bug; a default of something invalid
  that forces the caller to supply a real value is often safer.
