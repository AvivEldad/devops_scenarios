# The build server that fills its own disk and stops

## Briefing

The Jenkins controller stopped scheduling builds. The UI is sluggish, new builds sit in
the queue, and the system log shows `No space left on device`. The disk is full of build
history — logs, archived artifacts and workspaces going back two years.

Nothing was ever configured to discard old builds, so every job keeps everything
forever.

## Your Task

- Identify what is consuming the disk on a Jenkins controller.
- Add retention so old builds are discarded automatically.
- Reclaim space safely without deleting builds you need.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    // no buildDiscarder - every build is kept forever

    stages {
        stage('Build') {
            steps {
                sh 'dd if=/dev/zero of=big.bin bs=1M count=50'
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'big.bin'
        }
    }
}
```

### file: notes.md

```text
$JENKINS_HOME/jobs/<job>/builds/<n>/   -> per-build logs and metadata
$JENKINS_HOME/jobs/<job>/builds/<n>/archive/  -> archived artifacts
$JENKINS_HOME/workspace/  (on agents)  -> checked-out source, build output
```

## Expected Failure

Each build archives a 50 MB artifact and nothing is ever removed:

```bash
du -sh $JENKINS_HOME/jobs/*/builds | sort -h | tail
# 48G  jobs/nightly/builds
```

Eventually:

```
java.io.IOException: No space left on device
hudson.model.Queue: Cannot schedule build, disk full
```

The controller cannot write build records, so it stops accepting work.

## Expected Outcome

Retention is configured and disk is bounded.

Old builds are discarded automatically:

```groovy
options { buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10')) }
```

Disk usage stops growing without bound:

```bash
# after retention takes effect, builds/ holds ~30 entries, not thousands
ls $JENKINS_HOME/jobs/nightly/builds | grep -c '^[0-9]'
# ~30
```

Space is reclaimed:

```bash
du -sh $JENKINS_HOME/jobs/*/builds | sort -h | tail
# dramatically reduced
```

Artifacts are kept for fewer builds than logs, since they are the bulk of the size:

```
# logs kept for 30 builds, artifacts for 10
```

## Hints

### Hint 1 — Attribute the space first

```bash
du -sh $JENKINS_HOME/jobs/*/builds | sort -h | tail
du -sh $JENKINS_HOME/workspace/* | sort -h | tail
```

Three consumers: build logs/metadata, archived artifacts, and agent workspaces.
Artifacts are usually the largest. Retention controls the first two; workspace cleanup
controls the third.

### Hint 2 — `buildDiscarder` with separate artifact retention

```groovy
options {
    buildDiscarder(logRotator(
        numToKeepStr: '30',           // keep 30 builds' logs/metadata
        artifactNumToKeepStr: '10',   // keep artifacts for only 10
        daysToKeepStr: '90'
    ))
}
```

Keeping artifacts for fewer builds than logs is the key move — you retain history and
status cheaply while discarding the heavy files quickly.

## Solution

No retention was configured, so everything accumulated until the disk filled.

```groovy
pipeline {
    agent any

    options {
        buildDiscarder(logRotator(
            numToKeepStr: '30',
            artifactNumToKeepStr: '10',
            daysToKeepStr: '90'
        ))
    }

    stages {
        stage('Build') {
            steps {
                sh 'dd if=/dev/zero of=big.bin bs=1M count=50'
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'big.bin', fingerprint: true
        }
        cleanup {
            cleanWs()
        }
    }
}
```

- **Jenkins keeps every build forever unless told otherwise.** `buildDiscarder` on every
  job is not optional on a busy controller — it is the difference between bounded and
  unbounded disk.
- **Retain artifacts for fewer builds than logs.** Logs and status are small and worth
  keeping; artifacts are large and usually only the recent ones matter. `artifactNumToKeepStr`
  is the highest-value setting.
- **Clean agent workspaces** with `cleanWs()` in `post`, and set a global default so jobs
  without their own discarder still rotate.
- **Recover safely when already full**: delete old `builds/<n>` directories or use the
  "Delete old builds" option, but never hand-edit `$JENKINS_HOME` while Jenkins is running
  in ways that corrupt job config — remove whole build directories, not individual files.
- **Move large artifacts off the controller.** Push releases to Nexus/Artifactory/S3 and
  archive only what you need on the build page; the controller's disk is not an artifact
  store.
