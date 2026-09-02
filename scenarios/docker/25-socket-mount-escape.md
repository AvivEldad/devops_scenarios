# The CI container that is secretly root on the host

## Briefing

A build agent runs in a container. So it can build images, someone mounted the Docker
socket into it:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

This is on countless CI setups and in a great many blog posts. It also means anyone who
can run a build step — including, on many configurations, anyone who can open a pull
request — has root on the host, with no exploit required.

This scenario demonstrates the escalation, then removes the need for it.

## Your Task

- Start a deliberately unprivileged container with the socket mounted.
- Demonstrate that it can read and modify host files it was never granted access to.
- State the mechanism in one sentence.
- Replace the socket mount with an approach that lets builds happen without granting
  host root.

> This runs real containers as your user. It does not damage anything, but understand
> each command before running it, and do not do this on a shared or production host.

## Starter Files

### file: victim-setup.sh

```bash
#!/usr/bin/env bash
# Creates a host file the container should NOT be able to read.
set -euo pipefail
sudo sh -c 'echo "TOP SECRET host data" > /root/host-secret.txt'
sudo chmod 600 /root/host-secret.txt
echo "created /root/host-secret.txt (root-only, mode 600)"
```

### file: agent-compose.yml

```yaml
services:
  build-agent:
    image: docker:27-cli
    # deliberately unprivileged: no --privileged, a non-root user
    user: "1000:1000"
    command: sleep infinity
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

## Expected Failure

```bash
bash victim-setup.sh
docker compose -f agent-compose.yml up -d
```

Inside the container, the user is unprivileged and cannot read the secret directly:

```bash
docker compose -f agent-compose.yml exec build-agent id
# uid=1000 gid=1000

docker compose -f agent-compose.yml exec build-agent cat /root/host-secret.txt
# cat: can't open '/root/host-secret.txt': Permission denied  (or no such file)
```

But the socket is a full Docker API. The container can ask the daemon — which runs as
root on the host — to start a *new* container that mounts the host root filesystem:

```bash
docker compose -f agent-compose.yml exec build-agent \
  docker run --rm -v /:/host alpine cat /host/root/host-secret.txt
```

```
TOP SECRET host data
```

An unprivileged process just read a root-only host file. It can equally write to
`/host/etc`, add an SSH key to `/host/root/.ssh`, or start a privileged container — the
socket grants all of it.

## Expected Outcome

The build agent can build images without any path to host root.

**The socket is not mounted anywhere:**

```bash
docker compose -f agent-secure.yml config | grep -i docker.sock
# (no output)
```

**Builds still work**, using a rootless daemon-in-container or a daemonless builder:

```bash
# with the rootless dind approach
docker compose -f agent-secure.yml exec build-agent \
  docker build -t test - <<< 'FROM alpine
RUN echo built'
# built
```

**The escalation no longer works** — there is no host daemon to reach:

```bash
docker compose -f agent-secure.yml exec build-agent \
  sh -c 'docker run --rm -v /:/host alpine cat /host/root/host-secret.txt 2>&1' || true
# cannot connect to a host daemon / the mount refers only to the isolated builder
```

**The build runs unprivileged:**

```bash
docker compose -f agent-secure.yml exec build-agent id
# uid=1000 ... (or a rootless daemon setup)
```

Clean up:
`docker compose -f agent-compose.yml down; docker compose -f agent-secure.yml down; sudo rm -f /root/host-secret.txt`

## Hints

### Hint 1 — The socket is the daemon, and the daemon is root

`/var/run/docker.sock` is the Docker Engine API. Anything that can talk to it can
instruct the daemon, and the daemon runs as root on the host. There is no privilege
boundary between "access to the socket" and "root on the host" — they are the same
thing.

`--privileged`, `user:` and capability drops on the *agent* container are irrelevant,
because the escalation happens in a *second* container the agent asks the host daemon to
create. Restricting the first container does nothing about that.

The one-sentence mechanism: mounting the socket lets the container create new containers
on the host, and a container can mount the entire host filesystem.

### Hint 2 — Build without the host daemon

Options, roughly in increasing order of isolation:

- **Rootless Docker-in-Docker**: run a `dind-rootless` daemon inside the agent, isolated
  from the host daemon. The agent talks to *its own* daemon over an internal socket.
- **Kaniko**: builds images from a Dockerfile inside a container with no daemon at all.
  Popular in Kubernetes CI.
- **Buildah / `buildkitd` rootless**: daemonless or rootless image building.
- **BuildKit as a separate service**: the agent connects to a `buildkitd` over TCP with
  mTLS, so there is no socket and no host daemon access.

All of them let you build images. None of them hand out host root.

## Solution

Mounting the host Docker socket grants host root to whatever can reach it. Remove it,
and build with an isolated builder instead.

**Rootless Docker-in-Docker**, self-contained:

```yaml
# agent-secure.yml
services:
  dind:
    image: docker:27-dind-rootless
    privileged: true          # required to run its OWN daemon, isolated from the host
    environment:
      DOCKER_TLS_CERTDIR: /certs
    volumes:
      - certs:/certs
      - dind-storage:/var/lib/docker

  build-agent:
    image: docker:27-cli
    depends_on: [dind]
    environment:
      DOCKER_HOST: tcp://dind:2376
      DOCKER_TLS_VERIFY: "1"
      DOCKER_CERT_PATH: /certs/client
    command: sleep infinity
    volumes:
      - certs:/certs

volumes:
  certs:
  dind-storage:
```

The agent's `docker` commands go to the isolated dind daemon, which has no access to the
host. Note that `privileged: true` here is on the *dind* service so it can run its own
daemon — it is isolated from the host, unlike a mounted socket.

**Kaniko**, daemonless, ideal in Kubernetes:

```bash
docker run --rm \
  -v "$PWD:/workspace" \
  gcr.io/kaniko-project/executor:latest \
  --dockerfile=/workspace/Dockerfile \
  --context=/workspace \
  --destination=myrepo/svc:ci
```

- **Socket access equals host root. Full stop.** No amount of hardening on the container
  that holds the socket changes this, because the escalation is performed by a different
  container that the host daemon obediently creates.
- **This is the most common serious misconfiguration in self-hosted CI**, precisely
  because it is the path of least resistance and it is in so many tutorials. If your CI
  runs untrusted code — and any repo that accepts pull requests does — it is a direct
  remote-root vulnerability.
- **"Just build images" has daemonless answers now.** Kaniko, Buildah and rootless
  BuildKit did not exist when the socket-mount pattern became folklore. There is no
  longer a good reason to mount the socket for building.
- **If you truly must expose the daemon**, put it behind a socket proxy such as
  `tecnativa/docker-socket-proxy` that allows only specific, read-mostly API calls — but
  treat that as a last resort, not a default.
- **The same warning applies to Kubernetes**: mounting the node's container runtime
  socket, or `hostPath` onto `/`, into a pod is the identical escalation.
