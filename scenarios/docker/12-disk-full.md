# No space left on device, and nothing is running

## Briefing

The build server is out of disk. `docker ps` shows one small container. The team's
first move was to delete application logs, which recovered 200 MB and lasted an hour.

Docker is using 40 GB, almost none of it for anything currently in use. You need to
find where it went, reclaim it safely, and stop it happening again.

## Your Task

- Fill the local Docker storage with the setup commands below.
- Account for the space: which category is consuming it?
- Reclaim it without deleting anything that is in use.
- Put a control in place so this does not recur.

## Starter Files

### file: fill.sh

```bash
#!/usr/bin/env bash
# Creates the kind of accumulation a busy build server produces.
set -euo pipefail

for i in 1 2 3 4 5; do
  printf 'FROM python:3.11-slim\nRUN dd if=/dev/urandom of=/blob bs=1M count=60\nRUN echo build-%s\n' "$i" \
    | docker build -q -t throwaway:build-$i -
done

# retag them all so the originals become dangling
for i in 1 2 3 4 5; do
  docker tag throwaway:build-$i throwaway:latest
done

# a few stopped containers and an orphaned volume
for i in 1 2 3; do
  docker run --name dead-$i -v vol-$i:/data throwaway:latest \
    sh -c 'dd if=/dev/urandom of=/data/blob bs=1M count=40' >/dev/null 2>&1
done

echo "done - now inspect the damage"
```

## Expected Failure

```bash
bash fill.sh
docker system df
```

```
TYPE            TOTAL   ACTIVE   SIZE      RECLAIMABLE
Images          6       1        1.2GB     1.1GB (91%)
Containers      3       0        24B       24B (100%)
Local Volumes   3       0        126MB     126MB (100%)
Build Cache     18      0        780MB     780MB
```

A build now fails:

```
ERROR: failed to solve: write /var/lib/docker/...: no space left on device
```

Meanwhile `docker ps` shows almost nothing, which is why the disk usage looks
inexplicable. Stopped containers, untagged images, unused volumes and the build cache
are all invisible to the commands people habitually run.

## Expected Outcome

Space is reclaimed and the accounting is understood.

You can attribute the usage before deleting anything:

```bash
docker system df -v
# per-image, per-container and per-volume breakdown
```

Dangling images are gone:

```bash
docker images -f dangling=true -q | wc -l
# 0
```

Stopped containers are gone, running ones untouched:

```bash
docker ps -aq --filter status=exited | wc -l
# 0
docker ps -q | wc -l
# unchanged from before the cleanup
```

The build cache is bounded rather than unbounded:

```bash
docker system df --format '{{.Type}}\t{{.Size}}' | grep -i 'build cache'
# a small size, not hundreds of megabytes
```

Reclaimable space has dropped substantially:

```bash
docker system df
# RECLAIMABLE is now a small fraction of total
```

**Data you care about survives.** Create a named volume with content, run the cleanup,
and confirm it is still there:

```bash
docker volume create keepme
docker run --rm -v keepme:/d busybox sh -c 'echo important > /d/file'
# ... run your cleanup ...
docker run --rm -v keepme:/d busybox cat /d/file
# important
```

Clean up the lab: `docker rmi -f $(docker images 'throwaway' -q) 2>/dev/null; docker volume rm vol-1 vol-2 vol-3 keepme 2>/dev/null`

## Hints

### Hint 1 — `docker system df` before anything else

Four separate categories consume disk, and only one is visible in `docker ps`:

- **Images**, including untagged (dangling) layers left behind when a tag is moved
- **Containers**, including stopped ones and their writable layers
- **Volumes**, which outlive the containers that created them
- **Build cache**, which BuildKit grows without limit by default

`docker system df -v` gives the per-object breakdown so you can see which specific
images or volumes are large.

### Hint 2 — Prune selectively, and know what each command deletes

```bash
docker container prune              # stopped containers
docker image prune                  # dangling images only
docker image prune -a               # ALL images not used by a container - aggressive
docker builder prune                # build cache
docker volume prune                 # unused volumes - THIS DELETES DATA
```

`docker system prune -a --volumes` does everything at once and is exactly how people
destroy a database volume during an incident. Prune one category at a time and read
what it proposes.

## Solution

Untagged image layers, stopped containers, orphaned volumes and an unbounded build
cache — none of which appear in `docker ps`.

**Account first:**

```bash
docker system df
docker system df -v | head -40
```

**Reclaim, in increasing order of risk:**

```bash
# safe: nothing in use
docker container prune -f
docker image prune -f                       # dangling only
docker builder prune -f --keep-storage 5GB

# review before running: this deletes data
docker volume ls -f dangling=true
docker volume prune -f
```

**Prevent recurrence** with a daemon-level cache limit and a scheduled cleanup:

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "builder": {
    "gc": {
      "enabled": true,
      "defaultKeepStorage": "10GB"
    }
  }
}
```

```bash
sudo systemctl restart docker
```

```bash
# a conservative daily job
docker container prune -f --filter 'until=24h'
docker image prune -f --filter 'until=168h'
docker builder prune -f --keep-storage 10GB
```

- **Four categories, one of which is invisible.** The reason "nothing is running" feels
  contradictory is that `docker ps` shows only running containers, which is typically
  the smallest of the four.
- **Container logs are a fifth source** and a common one: without `max-size`, a chatty
  container's JSON log file grows without limit until the disk fills. The `log-opts`
  above are worth setting on every host you own.
- **`docker volume prune` deletes data.** Named volumes holding databases look exactly
  like abandoned ones if nothing is currently mounting them. List before pruning, every
  time.
- **On a build server, the build cache is usually the largest item** and the one nobody
  thinks of. `defaultKeepStorage` bounds it automatically, which is much better than
  finding out at 3 a.m.
- **`docker system prune -a --volumes` is the command to be careful with.** It is
  frequently pasted into incident channels as a quick fix and it will remove every image
  not currently in use — meaning your next deploy pulls everything again — plus every
  volume not currently mounted.
