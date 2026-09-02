# The Docker-agent build writes root-owned files

## Briefing

A pipeline runs its steps inside a Docker container agent. It works, but every build
leaves files in the workspace owned by `root`, and eventually a later build fails trying
to overwrite them with `Permission denied`.

The container runs as root by default, and its writes land in the workspace that Jenkins
mounts from the host agent, where the Jenkins user cannot manage them.

## Your Task

- Run the container-agent pipeline and inspect the ownership of files it creates.
- Explain why root-owned files appear in the agent's workspace.
- Make the build run as the Jenkins user so files are owned correctly.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent {
        docker { image 'python:3.11-slim' }
    }

    stages {
        stage('Build') {
            steps {
                sh '''
                    id
                    echo "artifact" > out.txt
                    ls -l out.txt
                '''
            }
        }
    }
}
```

## Expected Failure

```
+ id
uid=0(root) gid=0(root) groups=0(root)
+ echo "artifact"
+ ls -l out.txt
-rw-r--r-- 1 root root 9 out.txt
```

The container runs as root, so `out.txt` is owned by root in the workspace, which is a
host directory. The next build — or `cleanWs()` — running as the Jenkins user cannot
delete or overwrite it:

```
rm: cannot remove 'out.txt': Permission denied
```

## Expected Outcome

The build runs as the Jenkins user and files are owned by it.

```
+ id
uid=1000(jenkins) gid=1000(jenkins) ...
+ ls -l out.txt
-rw-r--r-- 1 jenkins jenkins 9 out.txt
```

Consecutive builds succeed, and workspace cleanup works without permission errors:

```
# build twice in a row, second build cleans and rebuilds cleanly
```

## Hints

### Hint 1 — The container's UID owns the workspace files

Jenkins mounts the agent's workspace into the container. Files the container creates are
owned by the container's user. Default images run as root (UID 0), so files are
root-owned on the host workspace, which the Jenkins user (typically UID 1000) cannot
manage.

### Hint 2 — Run the container as the Jenkins user

Pass the agent's UID/GID to the container:

```groovy
agent {
    docker {
        image 'python:3.11-slim'
        args '-u 1000:1000'
    }
}
```

Use the actual Jenkins UID on your agents. Some images misbehave without a home
directory for an unknown UID — set `-e HOME=/tmp` if tools complain.

## Solution

The container ran as root and wrote root-owned files into the shared workspace.

```groovy
pipeline {
    agent {
        docker {
            image 'python:3.11-slim'
            // run as the Jenkins agent user so workspace files are owned correctly
            args '-u 1000:1000 -e HOME=/tmp'
        }
    }

    options {
        skipDefaultCheckout(false)
    }

    stages {
        stage('Build') {
            steps {
                sh '''
                    set -euo pipefail
                    id
                    echo "artifact" > out.txt
                    ls -l out.txt
                '''
            }
        }
    }
    post {
        cleanup { cleanWs() }
    }
}
```

- **Container UID owns workspace files.** A root container leaves root-owned files in a
  host directory the Jenkins user cannot clean — the same UID-matching problem as the
  Docker bind-mount scenario, inside Jenkins.
- **`-u <uid>:<gid>` matching the Jenkins agent user** is the fix. Discover it with `id`
  on the agent; it is usually 1000 but confirm.
- **Set `HOME`** for images that expect a writable home for an unknown UID, or pip/npm and
  friends fail trying to write caches under `/`.
- **Prefer building images with a non-root `USER`** so this is the default, and keep
  `cleanWs()` in `post` so a stray root file does not wedge the next build.
