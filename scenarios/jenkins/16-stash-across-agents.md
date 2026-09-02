# Files vanish between stages on different agents

## Briefing

A pipeline builds on one agent and deploys on another. The deploy stage fails because
the build output is not there. Both stages ran successfully; the artifact simply does
not exist in the second stage's workspace.

Each agent has its own filesystem. Nothing carries files from one to the next unless you
move them explicitly.

## Your Task

- Run the two-stage pipeline and confirm the deploy stage cannot find the build output.
- Explain why the workspace does not follow the pipeline across agents.
- Carry the artifact from build to deploy.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent none

    stages {
        stage('Build') {
            agent { label 'builder' }
            steps {
                sh 'echo "compiled binary" > app.bin'
                sh 'ls -l app.bin'
            }
        }

        stage('Deploy') {
            agent { label 'deployer' }
            steps {
                sh 'cat app.bin'      // different agent - file is not here
            }
        }
    }
}
```

## Expected Failure

```
[Build]  + ls -l app.bin
[Build]  -rw-r--r-- 1 jenkins jenkins 16 app.bin
[Deploy] + cat app.bin
[Deploy] cat: app.bin: No such file or directory
Finished: FAILURE
```

The build ran on `builder` and produced `app.bin` in that agent's workspace. The deploy
ran on `deployer`, a different machine with a different, empty workspace.

## Expected Outcome

The deploy stage has the artifact.

```
[Deploy] + cat app.bin
[Deploy] compiled binary
Finished: SUCCESS
```

The transfer works regardless of which physical agents are chosen, and does not rely on
a shared network filesystem.

## Hints

### Hint 1 — Workspaces are per-agent

With `agent none` and per-stage agents, each stage may run on a different node with its
own filesystem. The workspace does not travel. Anything a later stage needs must be
carried to it.

### Hint 2 — `stash` and `unstash`

`stash` saves files to the controller; `unstash` restores them in a later stage on any
agent:

```groovy
stage('Build') {
    agent { label 'builder' }
    steps {
        sh 'echo "compiled binary" > app.bin'
        stash name: 'binary', includes: 'app.bin'
    }
}
stage('Deploy') {
    agent { label 'deployer' }
    steps {
        unstash 'binary'
        sh 'cat app.bin'
    }
}
```

Stash is for modest build outputs passed between stages. For large or long-lived
artifacts, use `archiveArtifacts` or a real artifact repository.

## Solution

The artifact stayed on the build agent. Stash it and unstash it in the deploy stage.

```groovy
pipeline {
    agent none

    stages {
        stage('Build') {
            agent { label 'builder' }
            steps {
                sh 'echo "compiled binary" > app.bin'
                stash name: 'binary', includes: 'app.bin'
            }
        }

        stage('Deploy') {
            agent { label 'deployer' }
            steps {
                unstash 'binary'
                sh 'cat app.bin'
            }
        }
    }
}
```

- **Each agent has its own workspace; it does not follow the pipeline.** Cross-agent
  pipelines must move files deliberately.
- **`stash`/`unstash` pass files between stages via the controller.** Keep stashes small —
  they go through the controller and large stashes are slow and memory-hungry.
- **For real artifacts, use a store.** `archiveArtifacts` for build-page retention, or
  Nexus/Artifactory/S3 for anything downstream jobs or humans consume later.
- **A shared NFS workspace "works" but is fragile.** It couples agents, creates locking
  and cleanup problems, and disappears the moment an agent is provisioned without the
  mount. Explicit transfer is more portable.
