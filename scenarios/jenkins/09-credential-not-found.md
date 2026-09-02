# credentials('...') fails with "Could not find credentials"

## Briefing

A pipeline references a credential by ID and fails immediately:
`Could not find credentials entry with ID 'deploy-key'`. The credential exists — you
can see it in the Jenkins UI.

The ID does not match, or the credential is stored in a scope the job cannot see. Both
are common and produce the same error.

## Your Task

- Run the pipeline and reproduce the missing-credential error.
- Determine the actual ID and scope of the credential.
- Reference it correctly so the job can bind it.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Deploy') {
            steps {
                withCredentials([string(credentialsId: 'deploy-key', variable: 'KEY')]) {
                    sh 'echo "using key of length ${#KEY}"'
                }
            }
        }
    }
}
```

### file: notes.md

```text
The credential actually stored in Jenkins:
  ID:     deploy_token         (underscore, not hyphen)
  Kind:   Secret text
  Scope:  Global
```

## Expected Failure

```
ERROR: Could not find credentials entry with ID 'deploy-key'
Finished: FAILURE
```

The credential exists as `deploy_token`. The pipeline asked for `deploy-key`. IDs are
exact strings — a hyphen versus an underscore is enough to miss.

## Expected Outcome

The credential binds and the job runs.

```
+ echo "using key of length 40"
using key of length 40
Finished: SUCCESS
```

The credential ID in the Jenkinsfile matches the stored ID exactly, and the binding type
matches the credential kind (`string` for Secret text).

## Hints

### Hint 1 — The ID is an exact match

`credentialsId` must equal the stored ID character for character. Find the real ID under
**Manage Jenkins → Credentials**; it is the `ID` column, not the description. Here it is
`deploy_token`, not `deploy-key`.

### Hint 2 — The binding type must match the credential kind

- Secret text → `string(credentialsId:, variable:)`
- Username/password → `usernamePassword(credentialsId:, usernameVariable:, passwordVariable:)`
- SSH key → `sshUserPrivateKey(...)`
- Secret file → `file(...)`

Using the wrong binding for the kind also fails, sometimes with a less obvious message.

## Solution

The ID was wrong. Match it exactly and use the right binding for a Secret text.

```groovy
pipeline {
    agent any

    stages {
        stage('Deploy') {
            steps {
                withCredentials([string(credentialsId: 'deploy_token', variable: 'KEY')]) {
                    // single quotes so the shell reads the value; do not echo secrets in real jobs
                    sh 'test -n "$KEY" && echo "key is present"'
                }
            }
        }
    }
}
```

- **Credential IDs are exact.** Copy the ID from the Credentials page rather than typing
  it; hyphen/underscore and case mistakes are the usual cause of "not found".
- **Scope matters too.** A credential stored in a folder or a specific job is invisible to
  jobs outside it. If the ID is right and it still fails, check the credential is Global
  or in a folder the job belongs to.
- **Match the binding to the kind.** `string` for secret text, `usernamePassword` for
  paired credentials, and so on — the "Pipeline Syntax → withCredentials" generator emits
  the correct call.
- **Do not echo secrets even to test them.** Check length or presence instead; the earlier
  masking rules still apply.
