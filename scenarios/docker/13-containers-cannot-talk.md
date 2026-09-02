# The API cannot reach the database container

## Briefing

Two containers on the same host. The API connects to `db:5432` and gets
`Name or service not known`. Both are running, both are healthy, and `docker ps` shows
them side by side.

They are on a network that does not do what people assume it does.

## Your Task

- Start both containers as given and reproduce the resolution failure.
- Find out which network each container is on and what name resolution it provides.
- Make the API reach the database by name, without publishing any ports to the host.

## Starter Files

### file: start.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

docker rm -f db api 2>/dev/null || true

docker run -d --name db \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=orders \
  postgres:16-alpine

docker run -d --name api python:3.11-slim \
  sh -c 'sleep infinity'

echo "started. now run: docker exec api sh -c \"getent hosts db\""
```

## Expected Failure

```bash
bash start.sh
docker exec api sh -c 'getent hosts db; echo "exit=$?"'
# exit=2        <- no such name

docker exec api sh -c 'apt-get update -qq && apt-get install -y -qq netcat-openbsd >/dev/null 2>&1; nc -zv db 5432'
# nc: getaddrinfo for host "db" port 5432: Name or service not known
```

The database is definitely running and listening:

```bash
docker exec db pg_isready
# /var/run/postgresql:5432 - accepting connections
```

Both containers are on the default bridge network, and it provides no DNS:

```bash
docker inspect api --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'
# bridge
```

## Expected Outcome

The API resolves and connects to the database by container name.

```bash
docker exec api sh -c 'getent hosts db'
# 172.20.0.2      db
```

A TCP connection succeeds:

```bash
docker exec api sh -c 'nc -zv db 5432'
# db (172.20.0.2:5432) open
```

Both containers are on a user-defined network:

```bash
docker inspect api --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
# appnet
docker inspect db --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
# appnet
```

No port is published to the host — the database must not be reachable from outside:

```bash
docker port db
# (no output)

nc -zv localhost 5432
# connection refused
```

An alias also resolves, proving it is real DNS rather than a hosts-file hack:

```bash
docker exec api sh -c 'getent hosts database'
# 172.20.0.2      database
```

Clean up: `docker rm -f db api && docker network rm appnet`

## Hints

### Hint 1 — The default bridge has no DNS

Containers started without `--network` land on the built-in `bridge` network. It gives
them IP connectivity to each other but **no name resolution** — container names are not
resolvable there.

A user-defined bridge network does provide an embedded DNS server, so containers can
find each other by name and by network alias. This is the single practical reason to
always create one.

```bash
docker network create appnet
docker run -d --name db --network appnet ...
```

### Hint 2 — Do not reach for `--link` or host ports

`--link` is deprecated and works by writing `/etc/hosts` entries, which do not update
when a container restarts with a new IP.

Publishing the database port with `-p 5432:5432` and connecting via `host.docker.internal`
or the host IP also "works", and it exposes your database to the entire host and
potentially the network. Container-to-container traffic should stay on a container
network.

## Solution

Both containers were on the default bridge network, which provides no DNS.

```bash
#!/usr/bin/env bash
set -euo pipefail

docker rm -f db api 2>/dev/null || true
docker network create appnet 2>/dev/null || true

docker run -d --name db \
  --network appnet \
  --network-alias database \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=orders \
  postgres:16-alpine

docker run -d --name api \
  --network appnet \
  -e DATABASE_URL='postgres://postgres:devpass@db:5432/orders' \
  python:3.11-slim sh -c 'sleep infinity'
```

- **Always create a user-defined network.** The embedded DNS resolves container names
  and aliases, updates automatically when a container restarts with a new IP, and
  isolates the group from unrelated containers on the host.
- **Network aliases give a container several names**, which lets you point application
  config at a stable service name while keeping a distinct container name.
- **Publish ports only for traffic that must come from outside the host.** A database
  that only the API talks to needs no `-p` at all, and publishing it binds `0.0.0.0` by
  default — reachable from your whole network, not just localhost.
- **Docker Compose does this for you**: it creates a network per project and every
  service is resolvable by its service name. That is why the same setup "just works" in
  Compose and fails with raw `docker run`.
- **Resolution happens at connect time, not at start time.** A container that starts
  before the database exists will still resolve it later — but your application needs to
  retry, because the first connection attempt may well fail.
