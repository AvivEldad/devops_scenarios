# The bind mount that deleted your application

## Briefing

The image works. Add a volume so you can edit code without rebuilding, and the
container immediately fails with `can't open file '/srv/app.py'`.

The file is definitely in the image — you can prove it. Something is covering it up.

## Your Task

- Run without the mount and confirm the image is fine.
- Run with the mount and observe the failure.
- Explain what happened to the files that were in `/srv`.
- Set up a working development mount.

## Starter Files

### file: app.py

```python
import time

print("api starting")
while True:
    time.sleep(5)
```

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

## Expected Failure

```bash
docker build -t api .
docker run --rm api
# api starting          <- fine

mkdir -p src && mv app.py src/
docker run --rm -v "$PWD/src:/srv" api
```

```
python: can't open file '/srv/app.py': [Errno 2] No such file or directory
```

Except `src/app.py` exists on your host. Look inside:

```bash
docker run --rm -v "$PWD/src:/srv" api ls -la /srv
# app.py     <- it IS there
```

So the file exists and Python cannot open it. Try the original layout instead:

```bash
mv src/app.py . && rmdir src
docker run --rm -v "$PWD/empty:/srv" api
# python: can't open file '/srv/app.py'
```

## Expected Outcome

Development mounting works: edit on the host, and the change takes effect without a
rebuild.

```bash
docker run -d --name api-dev -v "$PWD:/app" api-dev-image
docker logs api-dev
# api starting
```

Change the source on the host and restart the container — no rebuild:

```bash
sed -i 's/api starting/api starting v2/' app.py
docker restart api-dev
docker logs --tail 1 api-dev
# api starting v2
```

The installed dependencies are still present, which is the part a naive mount breaks:

```bash
docker exec api-dev python -c "import requests; print(requests.__version__)"
# 2.32.3
```

Nothing from the image has been hidden:

```bash
docker exec api-dev ls /srv
# app.py         <- the image's copy, still intact
```

Clean up: `docker rm -f api-dev`

## Hints

### Hint 1 — A mount replaces the directory, it does not merge

Bind-mounting a host directory onto `/srv` makes `/srv` *become* the host directory for
that container. Everything the image put there is still in the image layer but is no
longer visible at that path — the mount is on top of it.

So mounting an empty or differently-populated directory over your application
directory removes the application.

### Hint 2 — Mount somewhere the image does not use

The clean pattern is to keep the image's contents at one path and mount source at
another, or to mount only the specific files you are iterating on:

```bash
# mount source separately
docker run -v "$PWD:/app" -w /app image python app.py

# or a single file
docker run -v "$PWD/app.py:/srv/app.py" image
```

Anonymous volumes can also shield a subdirectory from being covered:
`-v /srv/.venv` keeps the image's virtualenv visible even when `/srv` is mounted.

## Solution

The bind mount replaced `/srv` entirely, hiding `app.py` and everything else the build
had put there.

Keep dependencies at a path the mount does not touch, and mount source separately:

```dockerfile
FROM python:3.11-slim

# dependencies live outside the directory that gets mounted
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app
COPY app.py .
CMD ["python", "app.py"]
```

```bash
docker build -t api-dev-image .

# production: no mount, uses the image's copy
docker run --rm api-dev-image

# development: host source replaces the image's copy, deliberately
docker run --rm -v "$PWD:/app" api-dev-image
```

- **A mount at a path hides whatever the image had there.** This is the single most
  common cause of "it worked until I added a volume", and it applies equally to
  Kubernetes `volumeMounts`, which will happily hide `/etc` or your application
  directory in exactly the same way.
- **Named volumes behave differently on first use:** an empty named volume mounted over
  a populated image directory is *pre-populated* from the image. Bind mounts never are.
  That inconsistency is worth remembering, because it makes bind mounts feel broken by
  comparison.
- **Install dependencies outside the mounted directory.** Anything inside it — a
  virtualenv, `node_modules`, compiled assets — will be shadowed by the host's version
  or absence of it.
- **Mount read-only where you can:** `-v "$PWD:/app:ro"` prevents the container writing
  into your working tree, which stops root-owned files appearing in your repository.
