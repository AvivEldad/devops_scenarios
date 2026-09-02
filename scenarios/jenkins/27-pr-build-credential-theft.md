# A pull request build that can steal your credentials

## Briefing

A multibranch pipeline builds pull requests, including from forks. To "make PR builds
useful", someone configured it to run with deploy credentials and to build PRs
automatically. A security researcher opened a PR that modified the Jenkinsfile to print
those credentials, and the build obligingly did.

Running untrusted PR code with secrets, automatically, is a remote credential-theft
vulnerability. This scenario removes the exposure while keeping PR CI useful.

## Your Task

- Understand how a fork PR can execute attacker-controlled pipeline code.
- Identify the three settings that combine into the vulnerability.
- Reconfigure so fork PRs get useful CI without access to secrets, and trusted changes
  can still deploy.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    environment {
        // available to whatever this branch's Jenkinsfile does - including a fork's
        DEPLOY_TOKEN = credentials('prod-deploy-token')
        AWS_SECRET   = credentials('aws-secret-key')
    }

    stages {
        stage('Build & Test') {
            steps {
                sh 'make test'
            }
        }
        stage('Deploy preview') {
            steps {
                // a fork PR can edit this stage to exfiltrate the credentials above
                sh 'curl -H "Authorization: Bearer $DEPLOY_TOKEN" https://preview/deploy'
            }
        }
    }
}
```

### file: notes.md

```text
Multibranch settings (current):
  Discover pull requests from forks:  "The current pull request revision"
  Build strategy:                     build all PRs automatically
  Credentials:                        bound at top level for every branch and PR
```

## Expected Failure

A fork PR changes the pipeline to leak the secret, and the automatic build runs it with
the credentials in scope:

```
+ echo $DEPLOY_TOKEN | base64        # attacker-added line in the PR's Jenkinsfile
Z2xwYXQtOWZKMmtk... (the real token, exfiltrated in the build log)
```

Because the Jenkinsfile comes from the PR branch, the attacker controls the pipeline
code, and because credentials are bound for all branches, that code can read them. No
Jenkins exploit is involved — the configuration hands over the keys.

## Expected Outcome

Fork PRs run tests with no secrets; trusted branches can deploy.

Fork PR builds have no access to deploy credentials:

```
# a fork PR that tries to read DEPLOY_TOKEN sees it unset/empty
+ echo ${DEPLOY_TOKEN:-<empty>}
<empty>
```

Fork PRs still get build-and-test feedback:

```
+ make test
tests passed
```

Deploy runs only on trusted, non-PR branches (e.g. `main`) where the code was reviewed:

```
# Deploy stage runs on main, skipped on PRs
```

Untrusted PRs require approval before building at all, or build in a restricted context:

```
# fork PR shows "waiting for approval to build" or builds without secrets
```

## Hints

### Hint 1 — The Jenkinsfile is code, and a PR controls it

For a PR build, the pipeline definition comes from the PR branch. That means a fork PR
author writes the code Jenkins executes. Anything that code can reach — secrets, the
controller, the network — is exposed to a stranger. This is the same boundary as GitHub
Actions' fork-secret rule, and Jenkins requires you to enforce it.

### Hint 2 — Three settings to change

- **Do not bind secrets for PR builds.** Scope credentials to the deploy stage and gate
  that stage on the branch, so PR builds never have them in the environment.
- **Require approval for fork PRs.** In multibranch, set fork PR trust to "From users with
  Write permission" or require a member to approve before building, so a stranger's code
  does not auto-run.
- **Gate deploy on trusted branches.** `when { branch 'main' }` so deployment (and its
  credentials) only ever runs on reviewed, merged code.

## Solution

Secrets bound for all branches, automatic fork builds, and no branch gate combined into
credential theft. Separate the trusted and untrusted paths.

```groovy
pipeline {
    agent any

    stages {
        stage('Build & Test') {
            // runs for everyone, including fork PRs - NO secrets in scope here
            steps {
                sh 'make test'
            }
        }

        stage('Deploy preview') {
            // only on trusted, non-PR branches; PRs never reach this stage
            when {
                allOf {
                    branch 'main'
                    not { changeRequest() }
                }
            }
            steps {
                // secrets scoped to the one stage that needs them, on trusted code only
                withCredentials([string(credentialsId: 'prod-deploy-token', variable: 'DEPLOY_TOKEN')]) {
                    sh 'curl -H "Authorization: Bearer $DEPLOY_TOKEN" https://preview/deploy'
                }
            }
        }
    }
}
```

And in the multibranch configuration:

- Discover fork PRs as "The current pull request revision", but set **fork PR trust** to
  "From users with Write permission", so a member must approve before a fork's code runs.
- Consider a build strategy that skips automatic builds of untrusted PRs.

- **A PR build runs code the PR author wrote.** For fork PRs that author is untrusted, so
  the pipeline definition itself is untrusted input. Never give untrusted pipeline code
  access to secrets.
- **Scope credentials to the smallest stage, gated on trusted branches.** Top-level
  `environment { credentials(...) }` exposes secrets to every branch including PRs;
  `withCredentials` inside a branch-gated stage does not.
- **Require approval for fork PR builds.** "Trust: from users with Write permission" stops a
  stranger's first push from auto-executing on your infrastructure.
- **Gate deployment on merged, reviewed code.** `when { branch 'main'; not { changeRequest() } }`
  ensures the credentialed path only runs on code that went through review.
- **This mirrors the GitHub Actions fork-secret boundary exactly.** Different tool, same
  rule: untrusted contributors get CI, not credentials.
