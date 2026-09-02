# Containers cannot resolve DNS after a network change

## Briefing

Every container on one host suddenly fails to resolve any hostname. `pip install`,
`apt update`, `curl https://...` — all fail with name-resolution errors. The host
itself resolves DNS perfectly.

This started after the office network changed its DNS servers. The host picked up the
change. The containers did not, because of where the daemon read its resolver
configuration and when.

## Your Task

- Reproduce a container that cannot resolve DNS while the host can.
- Determine what resolver configuration the container received and where it came from.
- Fix it for a single run, then for all containers on the host.
- Understand the systemd-resolved interaction that causes this specific case.

> Uses only Alpine and busybox images. No changes to your real DNS are required; the
> diagnosis works regardless of your host's setup.

## Starter Files

### file: diagnose.sh

```bash
#!/usr/bin/env bash
# Shows the resolver config the host and a container each see.
set -euo pipefail

echo "=== host /etc/resolv.conf ==="
cat /etc/resolv.conf

echo
echo "=== container /etc/resolv.conf ==="
docker run --rm alpine cat /etc/resolv.conf

echo
echo "=== host resolution ==="
getent hosts pypi.org || echo "host cannot resolve"

echo
echo "=== container resolution ==="
docker run --rm alpine sh -c 'nslookup pypi.org 2>&1 | tail -4' || echo "container cannot resolve"
```

### file: broken-daemon.json

```json
{
  "dns": ["10.255.255.1"]
}
```

## Expected Failure

The classic form of this failure is a container `resolv.conf` pointing at a nameserver
that no longer exists. Reproduce it deterministically by configuring the daemon with a
dead DNS server:

```bash
sudo cp broken-daemon.json /etc/docker/daemon.json
sudo systemctl restart docker

docker run --rm alpine cat /etc/resolv.conf
# nameserver 10.255.255.1

docker run --rm alpine sh -c 'nslookup pypi.org 2>&1 | tail -3'
# ;; connection timed out; no servers could be reached
```

The host is completely fine:

```bash
getent hosts pypi.org
# 151.101.0.223   pypi.org
```

The other common form: on a host using `systemd-resolved`, `/etc/resolv.conf` points at
the stub resolver `127.0.0.53`. Docker cannot copy that into containers, because
`127.0.0.53` inside a container's network namespace is the container itself, not the
host. When Docker detects this it falls back to public DNS — and if outbound DNS to
`8.8.8.8` is firewalled, as it often is on corporate networks, resolution fails silently.

## Expected Outcome

Containers resolve DNS again.

**A single run can be fixed immediately:**

```bash
docker run --rm --dns 1.1.1.1 alpine sh -c 'nslookup pypi.org 2>&1 | tail -3'
# Name: pypi.org  Address: ...
```

**The daemon default is corrected**, so all containers work:

```bash
docker run --rm alpine cat /etc/resolv.conf
# nameserver <a real, reachable server>

docker run --rm alpine sh -c 'nslookup pypi.org 2>&1 | tail -3'
# resolves successfully
```

**The host and containers agree on a working resolver:**

```bash
bash diagnose.sh
# both "host resolution" and "container resolution" succeed
```

**A real dependency install works end to end:**

```bash
docker run --rm python:3.11-slim sh -c 'pip install --quiet requests && python -c "import requests; print(\"ok\")"'
# ok
```

**The configuration is valid JSON** — a broken `daemon.json` prevents Docker starting at
all, so verify before restarting:

```bash
python3 -c "import json; json.load(open('/etc/docker/daemon.json'))" && echo "valid"
# valid
```

Restore afterwards: `sudo rm -f /etc/docker/daemon.json && sudo systemctl restart docker`

## Hints

### Hint 1 — Compare the two resolv.conf files first

```bash
cat /etc/resolv.conf
docker run --rm alpine cat /etc/resolv.conf
```

Docker generates a container's `/etc/resolv.conf` from, in order: the `--dns` flag, then
the daemon's `dns` setting in `daemon.json`, then the host's `/etc/resolv.conf` with any
loopback addresses stripped out.

If the container's file names a server that is unreachable — a stale entry, or a
loopback stub that was removed leaving a bad fallback — that is your answer.

### Hint 2 — The systemd-resolved stub is the subtle case

On Ubuntu and similar, `/etc/resolv.conf` is often a symlink to a file containing only
`nameserver 127.0.0.53`, the systemd-resolved stub. That address is meaningless inside a
container's network namespace.

Docker strips it and falls back to Google DNS, which fails if outbound DNS is blocked.
The robust fix is to point the daemon at the *real* upstream servers:

```bash
resolvectl status | grep 'DNS Servers'
# use these actual addresses in daemon.json
```

## Solution

The container's resolver configuration named a server it could not reach — either a
stale entry from `daemon.json` or a fallback that a firewall blocks.

**Immediate, per-run:**

```bash
docker run --rm --dns 1.1.1.1 --dns 8.8.8.8 alpine nslookup pypi.org
```

**Host-wide**, pointing at real, reachable resolvers:

```bash
# discover the actual upstream servers the host uses
resolvectl status | grep -A2 'Current DNS'
```

```json
// /etc/docker/daemon.json  -- use YOUR network's real servers
{
  "dns": ["192.168.1.1", "1.1.1.1"],
  "dns-search": ["corp.internal"]
}
```

```bash
python3 -c "import json; json.load(open('/etc/docker/daemon.json'))"   # validate first
sudo systemctl restart docker

docker run --rm alpine nslookup pypi.org
```

For Compose or a single service you can also set it locally:

```yaml
services:
  app:
    image: python:3.11-slim
    dns:
      - 1.1.1.1
    dns_search:
      - corp.internal
```

- **A container's `/etc/resolv.conf` is generated by the daemon, not shared with the
  host.** The precedence is `--dns`, then `daemon.json`, then the host file with loopback
  addresses removed. Diagnose by comparing the host and container files directly.
- **`systemd-resolved`'s `127.0.0.53` stub cannot be used inside a container**, because
  loopback in the container namespace is the container. This is the root of a large
  fraction of "DNS works on the host but not in Docker" reports on Ubuntu.
- **Point the daemon at the real upstream servers**, discoverable with `resolvectl
  status`, rather than at the stub. Hardcoding a public resolver works until you are on a
  network that requires an internal one for private names.
- **`user-defined networks use Docker's own embedded DNS at `127.0.0.11`**, which handles
  container-name resolution and *forwards* external queries to the configured upstream.
  So this failure breaks external resolution while container-to-container names may still
  work — a confusing split symptom worth recognising.
- **A malformed `daemon.json` stops Docker from starting.** Always validate the JSON
  before restarting, or you turn a DNS problem into a dead daemon.
