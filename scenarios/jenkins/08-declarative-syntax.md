# The Jenkinsfile that will not compile

## Briefing

A new pipeline fails before any stage runs, with a wall of Groovy errors. The author
mixed declarative and scripted syntax, put steps in the wrong place, and left out a
required block.

Declarative pipelines have a strict structure. The error messages point at the exact
rule being broken, once you know how to read them.

## Your Task

- Run the pipeline and read the validation errors.
- Identify each structural mistake.
- Make it a valid declarative pipeline that builds and tests.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    // a bare assignment at pipeline scope - not allowed in declarative
    def target = "staging"

    stages {
        stage('Build') {
            // steps must be inside a steps block
            sh 'echo building'
        }

        stage('Test') {
            steps {
                // an if statement directly in steps - needs a script block
                if (target == "staging") {
                    sh 'echo testing staging'
                }
            }
        }
    }

    // post at the wrong nesting level
    stage('Deploy') {
        steps {
            sh 'echo deploying'
        }
    }
}
```

## Expected Failure

```
WorkflowScript: 4: Expected a step @ line 4, column 5
   def target = "staging"
   ^

WorkflowScript: 8: Expected one of "steps", "stages", ... @ line 8
   stage('Build') {
       sh 'echo building'

org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed
```

The pipeline never starts. Declarative pipelines are validated for structure before
execution.

## Expected Outcome

The pipeline is valid and runs all three stages.

```
+ echo building
+ echo testing staging
+ echo deploying
Finished: SUCCESS
```

The structure follows declarative rules — variables in `environment`, steps inside
`steps`, conditionals inside `script`, stages inside `stages`.

## Hints

### Hint 1 — Declarative has a fixed skeleton

```
pipeline {
  agent ...
  environment { ... }
  stages {
    stage('X') {
      steps { ... }
    }
  }
  post { ... }
}
```

Every `stage` lives inside `stages` and contains a `steps` block. You cannot put bare
Groovy (`def`, `if`, `for`) directly in `steps` — that is scripted syntax.

### Hint 2 — Use `environment` for variables and `script` for logic

Variables belong in `environment {}`. Imperative logic — an `if`, a loop, a `def` — must
be wrapped in a `script { }` block, which drops into scripted mode for that region:

```groovy
steps {
    script {
        if (env.TARGET == 'staging') { sh 'echo testing staging' }
    }
}
```

## Solution

Four structural faults: a bare `def`, a `stage` missing its `steps`, an `if` outside a
`script`, and a `stage` outside `stages`.

```groovy
pipeline {
    agent any

    environment {
        TARGET = 'staging'
    }

    stages {
        stage('Build') {
            steps {
                sh 'echo building'
            }
        }

        stage('Test') {
            steps {
                script {
                    if (env.TARGET == 'staging') {
                        sh 'echo testing staging'
                    }
                }
            }
        }

        stage('Deploy') {
            steps {
                sh 'echo deploying'
            }
        }
    }
}
```

- **Declarative is validated before it runs.** A compilation error means a structural
  rule was broken; the message names the line and what it expected there.
- **`steps` is mandatory in every `stage`; `stages` contains every `stage`.** Most
  structural errors are something at the wrong nesting level.
- **Wrap imperative logic in `script {}`.** Prefer declarative constructs where they
  exist — `when {}` for conditionals, `environment {}` for variables — and reserve
  `script` for genuine logic, keeping those blocks small.
- **The "Pipeline Syntax" and "Declarative Directive Generator"** links in the Jenkins UI
  produce correct snippets, and the VS Code Jenkinsfile linter or `curl` to the
  `/pipeline-model-converter/validate` endpoint catches these before you push.
