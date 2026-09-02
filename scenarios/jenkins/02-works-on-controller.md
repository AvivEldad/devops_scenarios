# Works on the controller, fails on the agent

## Briefing

The team added two build agents last week to spread the load. Since then the
`reports` job fails roughly half the time, and which half appears random.

Re-running usually fixes it, so the team has settled into re-running. The build
history is a checkerboard of red and blue, and everyone has stopped reading it.

There is nothing random about it. The job passes when it lands on the controller and
fails when it lands on an agent, for three separate reasons — and a fourth problem
means that even a "successful" run on an agent is producing wrong output.

> You need Jenkins with at least one agent attached. The quickest route is the
> `jenkins/jenkins:lts-jdk17` container plus one inbound agent, or Docker-based
> agents. Any setup where a job can run somewhere other than the controller works.

## Your Task

Run the job repeatedly until you have seen it both pass and fail. Then:

1. Determine what differs between the two environments, using evidence from the build
   log rather than by guessing.
2. Fix the pipeline so it produces identical results on any executor.
3. Fix the fourth fault: the credential handling, which currently leaks.

Do not solve it by pinning the job to the controller. Running everything on the
controller is a real anti-pattern — it removes your ability to scale and gives builds
access to Jenkins' own filesystem and credentials.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    environment {
        REPORT_API_TOKEN = credentials('report-api-token')
    }

    stages {
        stage('Prepare') {
            steps {
                sh 'echo "building on $(hostname)"'
                sh 'echo "token is $REPORT_API_TOKEN"'
            }
        }

        stage('Generate') {
            steps {
                sh '''
                    jq --version
                    python3 generate_report.py > report.json
                '''
            }
        }

        stage('Publish') {
            steps {
                sh '''
                    cat previous-report.json > /dev/null 2>&1 && echo "found previous run"
                    cp report.json /var/reports/latest.json
                '''
            }
        }
    }
}
```

### file: generate_report.py

```python
#!/usr/bin/env python3
import json
import os
import subprocess

commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"]).decode().strip()

print(json.dumps({
    "commit": commit,
    "builder": os.uname().nodename,
    "records": 128,
}, indent=2))
```

## Expected Failure

On the controller the job passes. On an agent you get one of these, depending on
which agent picked it up:

```
+ jq --version
/home/jenkins/workspace/reports@tmp/durable-8f2a/script.sh: line 1: jq: command not found
```

or

```
+ cp report.json /var/reports/latest.json
cp: cannot create regular file '/var/reports/latest.json': No such file or directory
```

or the job passes but the output is wrong, because `previous-report.json` was found
in a workspace left behind by a **different job** that used the same directory.

And in every single build log, on every executor, this line appears:

```
+ echo "token is glpat-8fJ2kdLs93kfnAsd0012"
token is glpat-8fJ2kdLs93kfnAsd0012
```

The credential is printed in clear text to a log that anyone with read access to the
job can see, and which is retained for the next thirty builds.

## Expected Outcome

The job must behave identically wherever it runs.

Run it at least four times and confirm every build lands on a different executor and
all of them pass:

```
building on jenkins-agent-1     -> SUCCESS
building on jenkins-agent-2     -> SUCCESS
building on jenkins-controller  -> SUCCESS
```

The token never appears in the console output:

```
# search the console log of any build
token is glpat-      -> no match
****                 -> the mask appears instead
```

Jenkins should render it as `****` if it is printed at all.

The report is generated with real content:

```json
{
  "commit": "a1b2c3d",
  "builder": "jenkins-agent-2",
  "records": 128
}
```

The published artefact is retrievable from the build page rather than written to a
path that only exists on one machine:

```
Build Artifacts: report.json
```

Each build starts from a clean workspace. Add a temporary step that proves it:

```groovy
sh 'ls -la . && test ! -f previous-report.json && echo "clean workspace confirmed"'
```

This must print `clean workspace confirmed` on every consecutive run, including
immediately after a build that created files.

And the job declares what it needs rather than hoping for it — the pipeline should
fail with a clear message, not `command not found`, if a required tool is absent.

## Hints

### Hint 1 — Print the environment, then compare

Stop guessing which agent is different and make the pipeline tell you:

```groovy
sh '''
    echo "node: $(hostname)"
    echo "user: $(id -un) ($(id -u))"
    echo "cwd:  $(pwd)"
    echo "PATH: $PATH"
    command -v jq python3 git || true
'''
```

Run it on each executor and diff the output. `agent any` means Jenkins picks whichever
executor is free, so the "randomness" is just which machine you landed on.

You can pin temporarily while debugging with `agent { label 'agent-1' }`, but that is
a diagnostic, not the fix.

### Hint 2 — Agents are not clones of the controller

The controller image has tools installed that the agents do not, and `PATH` differs
because agents run commands through a non-login shell that never sources a profile.

Three ways to make tool availability explicit, in ascending order of robustness:

- assert the tool exists and fail with a useful message
- install it in the agent image so every agent is identical
- run the build in a container so the tool set travels with the job:

```groovy
agent {
    docker { image 'python:3.11-slim' }
}
```

The container approach is what most teams converge on, because it makes the build
environment a versioned artefact rather than a property of a machine someone
configured by hand.

### Hint 3 — `/var/reports` exists on exactly one machine

Writing build output to an absolute path outside the workspace assumes a filesystem
layout that agents do not share. It also means the result is stranded on whichever
machine ran the build.

Use `archiveArtifacts` instead. Artefacts are copied back to the controller, appear
on the build page, and are retrievable by later jobs and by humans:

```groovy
archiveArtifacts artifacts: 'report.json', fingerprint: true
```

Anything a build produces that matters should be an artefact, a published test
report, or pushed to a real store — never a file left on an agent.

### Hint 4 — Workspaces are reused, and shared by name

Jenkins reuses the workspace directory for a job on a given agent, and does not clean
it between builds. Files from the previous run — and sometimes from a different job
that happened to use the same path — are still there.

That is why `previous-report.json` was "found". Add a cleanup step, and consider
whether your build should depend on workspace state at all.

```groovy
options { skipDefaultCheckout(true) }
// ...
steps {
    cleanWs()
    checkout scm
}
```

or `post { cleanup { cleanWs() } }` to clean afterwards instead.

### Hint 5 — `credentials()` masks, `echo` defeats it

Binding a credential with `environment { X = credentials('id') }` registers it for
masking, which is why Jenkins usually replaces it with `****` in the log. But masking
is a string-replacement on the output and it is easy to defeat — by transforming the
value, by writing it to a file, or by a tool that reformats it.

The real fix is not to print it at all. Nothing in this pipeline needs to echo the
token; that line is leftover debugging. Where you do need a secret, prefer
`withCredentials` scoped to the smallest possible block:

```groovy
withCredentials([string(credentialsId: 'report-api-token', variable: 'TOKEN')]) {
    sh 'curl -sS -H "Authorization: Bearer $TOKEN" https://example.internal/publish'
}
```

Note the single quotes: `sh 'curl ... $TOKEN'` lets the **shell** expand the variable.
Double quotes would make **Groovy** interpolate it, baking the secret into the script
text that Jenkins logs. That distinction is the single most common way secrets leak
from a Jenkinsfile.

## Solution

Four faults: an undeclared tool dependency, a machine-specific output path, a dirty
reused workspace, and a credential printed to the log.

```groovy
pipeline {
    // the build environment travels with the job, so every executor is identical
    agent {
        docker {
            image 'python:3.11-slim'
            args '-u root:root'
        }
    }

    options {
        timestamps()
        timeout(time: 20, unit: 'MINUTES')
        skipDefaultCheckout(true)
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    stages {
        stage('Prepare') {
            steps {
                cleanWs()
                checkout scm
                sh '''
                    set -euo pipefail
                    echo "building on $(hostname) as $(id -un)"
                    # fail loudly and early if a dependency is missing
                    for tool in python3 git; do
                        command -v "$tool" >/dev/null || {
                            echo "required tool not found: $tool" >&2
                            exit 1
                        }
                    done
                '''
            }
        }

        stage('Generate') {
            steps {
                sh '''
                    set -euo pipefail
                    python3 generate_report.py > report.json
                    test -s report.json
                '''
            }
        }

        stage('Publish') {
            steps {
                withCredentials([string(credentialsId: 'report-api-token',
                                        variable: 'TOKEN')]) {
                    // single quotes: the shell expands $TOKEN, not Groovy
                    sh '''
                        set -euo pipefail
                        curl -sS --fail \
                             -H "Authorization: Bearer $TOKEN" \
                             -H "Content-Type: application/json" \
                             --data @report.json \
                             https://reports.internal/api/v1/publish
                    '''
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'report.json',
                             fingerprint: true,
                             allowEmptyArchive: true
        }
        cleanup {
            cleanWs()
        }
    }
}
```

The `jq` dependency is gone because nothing actually used it — worth checking before
you install a tool on every agent to satisfy a line someone left behind.

The principles that make a job portable across executors:

- **Declare the environment, do not inherit it.** A container image, or an agent image
  built from a Dockerfile in version control. "Someone SSHed in and installed jq" is
  not a reproducible build environment, and it is why the first agent worked and the
  second did not.
- **Never write outside the workspace.** Use `archiveArtifacts`, `stash`/`unstash`
  between stages, or push to a real artefact store. Absolute paths assume a machine.
- **Treat the workspace as dirty until proven clean.** Reuse is a performance feature
  and a correctness hazard. Clean explicitly when correctness matters more than speed.
- **Scope secrets as narrowly as possible.** `withCredentials` around the one step
  that needs it, rather than an `environment` block that exposes the value to every
  stage including any third-party plugin that logs its inputs.
- **Fail fast with a readable message.** `command not found` costs someone twenty
  minutes; `required tool not found: jq` costs them none.

On the flakiness itself: the job was never flaky. It was deterministic given which
executor ran it, and "flaky" was the label applied because the input nobody was
looking at — the node name — was invisible. That is worth remembering whenever a
build is described as intermittent.

## What You Learned

"Re-run it and it passes" is one of the most expensive habits a team can develop,
because it converts a diagnosable fault into background noise. Here the pipeline was
perfectly deterministic and the varying input was printed in the first line of every
log.

The portability rules generalise well beyond Jenkins: a CI job should carry its own
environment, write only inside its workspace, assume nothing was left over from last
time, and never let a secret reach stdout. Any job that satisfies those four
constraints will behave the same on your laptop, the controller, a new agent, and
whatever platform you migrate to next.
