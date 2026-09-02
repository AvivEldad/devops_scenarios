# The script that cannot find its own config file

## Briefing

The image builds. The container starts and immediately fails to open
`config/settings.json`, which is definitely inside the image.

The file is there. The process is looking for it in a different place, because the
Dockerfile makes an assumption about the working directory that is never actually
established.

## Your Task

- Build and run, and read the exact path in the error message.
- Determine the container's working directory, and where the files actually landed.
- Fix it in a way that does not depend on the working directory at all.

## Starter Files

### file: run.py

```python
import json

with open("config/settings.json") as fh:
    settings = json.load(fh)

print(f"loaded settings for {settings['env']}")
```

### file: config/settings.json

```json
{ "env": "production", "workers": 4 }
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

COPY run.py /opt/report/run.py
COPY config /opt/report/config

CMD ["python", "/opt/report/run.py"]
```

## Expected Failure

```bash
docker build -t report .
docker run --rm report
```

```
Traceback (most recent call last):
  File "/opt/report/run.py", line 3, in <module>
    with open("config/settings.json") as fh:
FileNotFoundError: [Errno 2] No such file or directory: 'config/settings.json'
```

The file exists:

```bash
docker run --rm report ls -la /opt/report/config
# settings.json
```

And so does the working directory the process is actually using:

```bash
docker run --rm report pwd
# /
```

The script opened `config/settings.json` relative to `/`, which is `/config/settings.json`.

## Expected Outcome

The container runs from any invocation:

```bash
docker run --rm report
# loaded settings for production
```

The working directory is explicit rather than inherited:

```bash
docker run --rm report pwd
# /opt/report
```

Overriding the command still works, without needing to know the layout:

```bash
docker run --rm report python run.py
# loaded settings for production
```

The code does not depend on the caller's directory at all — confirm by running from
somewhere else inside the container:

```bash
docker run --rm -w /tmp report python /opt/report/run.py
# loaded settings for production
```

## Hints

### Hint 1 — The default working directory is `/`

Unless a Dockerfile sets `WORKDIR`, the container starts in the root directory. Every
relative path in your program is resolved from there, not from wherever the script
happens to live.

```dockerfile
WORKDIR /opt/report
```

`WORKDIR` also creates the directory if it does not exist, and applies to all following
`COPY`, `RUN` and `CMD` instructions — so setting it early also simplifies the paths in
the rest of the file.

### Hint 2 — Better: do not depend on the working directory

`WORKDIR` fixes this container. It does not fix the script, which will break again the
moment anyone runs it from a different directory, in CI, or under a scheduler.

Resolve paths relative to the file itself:

```python
from pathlib import Path

HERE = Path(__file__).resolve().parent
with open(HERE / "config" / "settings.json") as fh:
    ...
```

Now the location of the config is a property of the code layout, not of how it was
invoked.

## Solution

The Dockerfile never set a working directory, so relative paths resolved from `/`.

Fix both layers — the container and the script:

```dockerfile
FROM python:3.11-slim

WORKDIR /opt/report

COPY run.py .
COPY config ./config

CMD ["python", "run.py"]
```

```python
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

with open(HERE / "config" / "settings.json") as fh:
    settings = json.load(fh)

print(f"loaded settings for {settings['env']}")
```

- **Set `WORKDIR` in every Dockerfile.** The default of `/` is almost never what you
  want, and it makes `COPY` destinations and `CMD` arguments shorter and clearer too.
- **`WORKDIR` is absolute and persistent.** Repeated `WORKDIR` instructions are relative
  to the previous one, which is occasionally useful and frequently surprising.
- **`RUN cd /somewhere` does not persist.** Each `RUN` is a separate shell; the
  directory change is discarded at the end of the instruction. `WORKDIR` is the only way
  to change it for subsequent instructions.
- **Resolve resource paths from `__file__`** (or the language equivalent) rather than
  the current directory. Anything that depends on where it was invoked from will
  eventually be invoked from somewhere else — by cron, by a CI runner, by a
  supervisor — and fail in a way that is tedious to reproduce.
- **Configuration is often better passed as environment variables** than read from a
  bundled file, which removes the path question entirely and makes the same image
  usable across environments.
