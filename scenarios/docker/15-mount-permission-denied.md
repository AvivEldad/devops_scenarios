# Permission denied writing to a directory you own

## Briefing

The container writes its output to a bind-mounted directory. It fails with
`Permission denied`. The directory is owned by you, mode `755`, on your own machine.

Then someone "fixes" it by running the container as root, and now your working tree
contains root-owned files you cannot delete without `sudo`.

## Your Task

- Reproduce the write failure with the non-root container.
- Determine which user ID the container process actually has, and what the host
  directory permits.
- Make the container write successfully as a non-root user, with the resulting files
  owned by you on the host.

## Starter Files

### file: export.py

```python
from pathlib import Path

out = Path("/data/report.txt")
out.write_text("report contents\n")
print(f"wrote {out}")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim

RUN useradd --create-home --uid 1001 appuser

WORKDIR /srv
COPY export.py .

USER appuser
CMD ["python", "export.py"]
```

## Expected Failure

```bash
docker build -t exporter .
mkdir -p out
docker run --rm -v "$PWD/out:/data" exporter
```

```
Traceback (most recent call last):
  File "/srv/export.py", line 4, in <module>
    out.write_text("report contents\n")
PermissionError: [Errno 13] Permission denied: '/data/report.txt'
```

The directory looks fine from the host:

```bash
ls -ld out
# drwxr-xr-x 2 avive avive 4096 Aug 31 12:00 out
id -u
# 1000
```

The tempting "fix" creates a worse problem:

```bash
docker run --rm --user root -v "$PWD/out:/data" exporter
# wrote /data/report.txt

ls -l out/report.txt
# -rw-r--r-- 1 root root 16 Aug 31 12:01 out/report.txt

rm out/report.txt
# rm: cannot remove 'out/report.txt': Permission denied
```

## Expected Outcome

The container writes as a non-root user, and the file belongs to you on the host.

```bash
docker run --rm -v "$PWD/out:/data" exporter
# wrote /data/report.txt
```

The file is owned by your host user:

```bash
ls -l out/report.txt
# -rw-r--r-- 1 avive avive 16 Aug 31 12:05 out/report.txt

stat -c '%u:%g' out/report.txt
# 1000:1000        <- matches your id -u / id -g
```

You can delete it without elevated privileges:

```bash
rm out/report.txt && echo "removed cleanly"
```

The container is **not** running as root:

```bash
docker run --rm -v "$PWD/out:/data" exporter id
# uid=1000 ... (not uid=0)
```

And it still works when the output directory does not exist yet:

```bash
rm -rf out && mkdir out
docker run --rm -v "$PWD/out:/data" exporter
# wrote /data/report.txt
```

## Hints

### Hint 1 — Bind mounts carry host ownership, and only UIDs are compared

A bind mount is the host directory, with the host's ownership and permissions. The
kernel compares **numeric user and group IDs** — usernames do not exist at that layer
and are never translated.

Your host directory is owned by UID 1000. The container process runs as UID 1001. Mode
`755` grants write only to the owner, so 1001 is denied.

```bash
docker run --rm exporter id
# uid=1001(appuser) gid=1001(appuser)
stat -c '%u:%g' out
# 1000:1000
```

The names `appuser` and `avive` are irrelevant; 1001 is not 1000.

### Hint 2 — Run as the host user's numeric ID

`--user` accepts raw IDs and does not require the user to exist inside the image:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/out:/data" exporter
```

Now the process is UID 1000, which owns the directory, and any file it creates is owned
by you on the host. This is the standard pattern for containers that write into a
developer's working tree or a CI workspace.

Note that with `--user` set to an ID with no matching entry in the image's
`/etc/passwd`, some tools complain about a missing home directory — set `HOME` if so.

## Solution

The container's UID did not match the host directory's owner. Running as root
"solved" it by creating root-owned files on the host, which is a worse outcome.

Pass the host user's numeric IDs at run time:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -v "$PWD/out:/data" \
  exporter
```

Keep a non-root default in the image, so it is safe when no `--user` is given:

```dockerfile
FROM python:3.11-slim

RUN useradd --create-home --uid 1001 appuser

WORKDIR /srv
COPY export.py .

# a sensible non-root default; override with --user for bind mounts
USER 1001:1001
ENV HOME=/tmp
CMD ["python", "export.py"]
```

In Compose:

```yaml
services:
  exporter:
    build: .
    user: "${UID:-1000}:${GID:-1000}"
    volumes:
      - ./out:/data
```

```bash
UID="$(id -u)" GID="$(id -g)" docker compose run --rm exporter
```

- **Only numeric IDs matter across the container boundary.** Usernames inside the image
  and on the host are unrelated namespaces; matching names with different numbers still
  fails, and matching numbers with different names works fine.
- **`--user "$(id -u):$(id -g)"` is the right default for anything writing to a bind
  mount.** It keeps the host filesystem clean and removes the temptation to run as root.
- **Named volumes avoid the problem** because Docker initialises their ownership from
  the image. If the data does not need to be visible on the host, prefer a named volume.
- **Running as root inside a container is a real risk**, not merely untidy: combined
  with a mounted host path it gives the container write access to host files as root,
  and combined with a mounted Docker socket it is a full host compromise.
- **`user namespace remapping`** (`userns-remap` in `daemon.json`) solves this class of
  problem at the daemon level by mapping container UIDs to a separate unprivileged
  range on the host. It is worth knowing about for multi-tenant hosts.
