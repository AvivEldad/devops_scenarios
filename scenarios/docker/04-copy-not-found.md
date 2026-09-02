# COPY failed: file not found, and the file is right there

## Briefing

The build fails saying it cannot find `app.py`. You are looking at `app.py`. It is in
the same directory as the `Dockerfile`, spelled correctly, and readable.

Docker is not lying to you. It is looking somewhere you did not expect.

## Your Task

- Run the build and read the error carefully, including the last argument of the
  command you typed.
- Work out which directory Docker is actually searching.
- Fix it without moving any files.

## Starter Files

### file: app.py

```python
print("report generated")
```

### file: docker/Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /srv
COPY app.py .
COPY ../config.json .
CMD ["python", "app.py"]
```

### file: config.json

```json
{ "output": "/srv/out" }
```

## Expected Failure

```bash
docker build -f docker/Dockerfile -t report docker/
```

```
ERROR: failed to solve: failed to compute cache key:
failed to calculate checksum of ref: "/app.py": not found
```

Move the build context and you trade it for a different error:

```bash
docker build -f docker/Dockerfile -t report .
```

```
ERROR: failed to solve: failed to compute cache key:
"/../config.json": not found
```

## Expected Outcome

The build succeeds and both files are in the image:

```bash
docker build -f docker/Dockerfile -t report .
docker run --rm report
# report generated

docker run --rm report ls /srv
# app.py
# config.json
```

You can state which directory was the build context in each failing case.

## Hints

### Hint 1 — The last argument is the build context

```bash
docker build -f docker/Dockerfile -t report docker/
#                                            ^^^^^^^ this is the context
```

`COPY` paths are resolved relative to the **build context**, never relative to the
`Dockerfile`. With `docker/` as the context, Docker only ever sees the contents of
`docker/`, and `app.py` is not in there.

The context is also uploaded to the daemon in full before the build starts, which is
why a context of `/` or your home directory is catastrophically slow.

### Hint 2 — You cannot escape the context

```dockerfile
COPY ../config.json .
```

This is forbidden by design. Nothing outside the context is reachable, because the
daemon never received it. `../` is rejected regardless of what is on your disk.

The fix is to choose a context that contains everything you need — usually the
repository root — and write paths relative to it.

## Solution

Two faults: the context excluded `app.py`, and one `COPY` tried to escape the context.

Build from the repository root, and make the paths relative to it:

```dockerfile
FROM python:3.11-slim
WORKDIR /srv
COPY app.py config.json ./
CMD ["python", "app.py"]
```

```bash
docker build -f docker/Dockerfile -t report .
```

- **`-f` sets the Dockerfile location; the final argument sets the context.** They are
  independent, which is exactly what confuses people. A Dockerfile in a subdirectory
  built from the root is a normal and correct arrangement.
- **Everything `COPY` can reach must be inside the context**, and the whole context is
  sent to the daemon first. Add a `.dockerignore` to keep `.git`, `node_modules` and
  build output out of it — this is often the single biggest build-speed win available.
- **`COPY a b ./`** with a trailing slash on the destination copies multiple sources
  into a directory. Without the slash, and with more than one source, the build fails.
