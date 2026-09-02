# The build fails on the CI runner and works on your laptop

## Briefing

`pip install` fails inside `docker build` on the CI runner with a connection timeout.
The same Dockerfile builds fine on your machine, and the runner itself has working
internet — you can `curl` the package index from a shell on it.

The build is a separate environment from the shell you tested in. Two things the
runner's shell has are not being passed into it, and a third makes the failure much
harder to read than it needs to be.

## Your Task

- Reproduce a build-time network failure by making the build environment differ from
  your shell.
- Establish why the build does not inherit your shell's proxy settings.
- Fix it so the build succeeds, without baking credentials or environment-specific
  settings into the image.

## Starter Files

### file: requirements.txt

```text
requests==2.32.3
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
CMD ["python", "app.py"]
```

### file: app.py

```python
import requests

print(f"requests {requests.__version__} available")
```

### file: reproduce.sh

```bash
#!/usr/bin/env bash
# Simulates a network-restricted build environment.
set -euo pipefail

export HTTP_PROXY="http://proxy.corp.invalid:3128"
export HTTPS_PROXY="$HTTP_PROXY"
export http_proxy="$HTTP_PROXY"
export https_proxy="$HTTP_PROXY"

echo "shell proxy is set:"
env | grep -i proxy

echo
echo "now build - note that the build does NOT see these:"
docker build -t netapp .
```

## Expected Failure

On a machine where the shell needs a proxy to reach the internet:

```bash
bash reproduce.sh
```

```
shell proxy is set:
HTTP_PROXY=http://proxy.corp.invalid:3128
...

#6 [3/5] RUN pip install --no-cache-dir -r requirements.txt
#6 30.14 WARNING: Retrying (Retry(total=4, connect=None, ...)) after connection
broken by 'NewConnectionError(...: Failed to establish a new connection:
[Errno -3] Temporary failure in name resolution)'
#6 ERROR: process "/bin/sh -c pip install --no-cache-dir -r requirements.txt"
did not complete successfully: exit code: 1
```

Your shell has the proxy. The build does not. `docker build` sends the context to the
daemon, and the daemon runs each `RUN` step in a fresh container that inherits nothing
from your shell — not proxy variables, not DNS overrides, not CA certificates.

The error also arrives thirty seconds late, because pip retries five times before
giving up.

## Expected Outcome

The build succeeds in the restricted environment, without embedding environment
specifics in the image.

The build completes:

```bash
docker build -t netapp .
docker run --rm netapp
# requests 2.32.3 available
```

**No proxy configuration is baked into the image**, so it remains portable:

```bash
docker inspect netapp --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i proxy
# (no output)

docker history netapp --no-trunc | grep -i 'proxy.corp'
# (no output)
```

**No credentials appear in any layer:**

```bash
docker history netapp --no-trunc | grep -iE 'token|password|secret'
# (no output)
```

**The failure is fast when the network genuinely is unavailable** — not a thirty-second
retry loop:

```bash
time docker build --network none -t netapp-fail . 2>&1 | tail -3
# fails in a few seconds with a clear message
```

**The build is reproducible on a machine with no proxy**, using the same Dockerfile:

```bash
docker build -t netapp . && docker run --rm netapp
# requests 2.32.3 available
```

## Hints

### Hint 1 — Build steps do not inherit your shell environment

`docker build` is a client that hands the context and the Dockerfile to the daemon. Each
`RUN` executes in a fresh container. Your shell's variables, `/etc/hosts` entries,
resolver settings and CA certificates are all absent unless the Dockerfile or the build
command puts them there.

Pass proxy settings as build arguments:

```bash
docker build \
  --build-arg HTTP_PROXY="$HTTP_PROXY" \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" \
  --build-arg NO_PROXY="$NO_PROXY" \
  -t netapp .
```

`HTTP_PROXY`, `HTTPS_PROXY`, `FTP_PROXY` and `NO_PROXY` are treated specially: Docker
supports them as build arguments without a corresponding `ARG` line, and does not
persist them into the image.

### Hint 2 — Do not bake environment specifics into the image

```dockerfile
ENV HTTP_PROXY=http://proxy.corp.invalid:3128   # wrong
```

This makes the image unusable anywhere else, and it records your internal topology in a
layer that may end up in a public registry. If the proxy URL contains credentials —
which corporate proxies often do — you have published them.

Configure the build environment instead, at the daemon or CLI level, and keep the
Dockerfile portable. For persistent local configuration, `~/.docker/config.json`
supports a `proxies` block that applies automatically to builds and runs.

## Solution

The build environment is separate from your shell, and nothing was carrying the proxy
configuration across.

Pass it at build time and keep the Dockerfile clean:

```bash
#!/usr/bin/env bash
set -euo pipefail

docker build \
  --build-arg HTTP_PROXY="${HTTP_PROXY:-}" \
  --build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" \
  --build-arg NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}" \
  --progress=plain \
  -t netapp .
```

Or configure it once, so every build and run picks it up:

```json
// ~/.docker/config.json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy.corp.invalid:3128",
      "httpsProxy": "http://proxy.corp.invalid:3128",
      "noProxy": "localhost,127.0.0.1,.internal"
    }
  }
}
```

Make the failure fast and readable rather than a silent retry loop:

```dockerfile
FROM python:3.11-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir \
      --timeout 10 --retries 2 \
      -r requirements.txt

COPY app.py .
CMD ["python", "app.py"]
```

And where a private index needs a credential, use a BuildKit secret so it never touches
a layer:

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=pipconf,target=/etc/pip.conf \
    pip install --no-cache-dir -r requirements.txt
```

```bash
docker build --secret id=pipconf,src="$HOME/.config/pip/pip.conf" -t netapp .
```

- **The build environment is not your shell.** Proxy variables, DNS, `/etc/hosts` and CA
  certificates all have to be passed in deliberately. "It works in a shell on the same
  machine" is not evidence that the build should work.
- **`HTTP_PROXY` and friends are special build arguments** — supported without `ARG` and
  excluded from the image configuration, precisely so builds stay portable.
- **Never `ENV` a proxy into an image.** It leaks internal topology, may leak
  credentials, and breaks the image everywhere else.
- **`--build-arg` is not for secrets.** Values are recorded in `docker history`. BuildKit's
  `--secret` mounts the value for one instruction and leaves nothing behind.
- **`--progress=plain`** shows full output instead of the collapsed view, which matters
  when the useful message is buried inside a retry loop.
- **`--network none`** is a good way to prove a build has no hidden network dependency,
  and `--network host` occasionally rescues a build that needs the host's resolver.
