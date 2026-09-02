# The build-time variable that is empty at runtime

## Briefing

The image is built with `--build-arg APP_VERSION=2.4.1`. The build log shows the value
being used. The running container reports version `unknown`.

Nobody has changed the code. The variable exists in one phase and not the other, and
the Dockerfile does not carry it across.

## Your Task

- Build with the build argument and confirm the value is present during the build.
- Run the container and confirm the value is gone.
- Make the version available at runtime, and understand why `ARG` alone cannot do it.

## Starter Files

### file: app.py

```python
import os

version = os.environ.get("APP_VERSION", "unknown")
mode = os.environ.get("APP_MODE", "unset")
print(f"service version={version} mode={mode}")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

ARG APP_VERSION=dev
ARG APP_MODE=production

RUN echo "building version ${APP_VERSION} in ${APP_MODE} mode"

WORKDIR /srv
COPY app.py .
CMD ["python", "app.py"]
```

## Expected Failure

```bash
docker build --build-arg APP_VERSION=2.4.1 -t svc .
```

The build clearly has the value:

```
#5 [2/4] RUN echo "building version 2.4.1 in production mode"
#5 0.198 building version 2.4.1 in production mode
```

The container does not:

```bash
docker run --rm svc
# service version=unknown mode=unset
```

## Expected Outcome

The version reaches the running process:

```bash
docker build --build-arg APP_VERSION=2.4.1 -t svc .
docker run --rm svc
# service version=2.4.1 mode=production
```

The value is baked into the image, visible without passing anything at run time:

```bash
docker inspect svc --format '{{range .Config.Env}}{{println .}}{{end}}' | grep APP_
# APP_VERSION=2.4.1
# APP_MODE=production
```

A runtime override still wins:

```bash
docker run --rm -e APP_MODE=debug svc
# service version=2.4.1 mode=debug
```

And the default still applies when no build argument is given:

```bash
docker build -t svc-default .
docker run --rm svc-default
# service version=dev mode=production
```

## Hints

### Hint 1 — `ARG` and `ENV` live in different phases

`ARG` exists only while the image is being built. It is available to `RUN` instructions
and to `ENV`/`LABEL` values, and it is discarded when the build finishes.

`ENV` is written into the image configuration and becomes an environment variable in
every container started from it.

Your application reads `os.environ` at runtime, so it needs `ENV`.

### Hint 2 — Bridge one to the other

```dockerfile
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
```

The `ARG` receives the build-time value; the `ENV` on the following line copies it into
the image. This idiom — same name, `ARG` then `ENV` — is how nearly every real
Dockerfile passes a version or commit SHA through.

## Solution

`ARG` values do not survive the build. Promote them to `ENV`.

```dockerfile
FROM python:3.11-slim

ARG APP_VERSION=dev
ARG APP_MODE=production

ENV APP_VERSION=${APP_VERSION} \
    APP_MODE=${APP_MODE}

RUN echo "building version ${APP_VERSION} in ${APP_MODE} mode"

WORKDIR /srv
COPY app.py .
CMD ["python", "app.py"]
```

- **`ARG` is build-time, `ENV` is runtime.** The `ARG`-then-`ENV` pair is the standard
  bridge, and it also means `docker inspect` can tell you what version an image
  contains — which is worth having when you find a mystery container in production.
- **Precedence at run time:** `docker run -e` overrides the image's `ENV`, which
  overrides nothing else. Build arguments cannot be changed after the build.
- **Never pass secrets as `--build-arg`.** They are recorded in the image metadata and
  visible in `docker history`. Use BuildKit's `--secret` mount instead, which leaves no
  trace in any layer.
- **`ARG` before the first `FROM`** is global and usable in `FROM` lines (for pinning a
  base image tag), but is *not* visible inside a build stage unless you redeclare it
  there. That scoping rule surprises people in multi-stage builds.
