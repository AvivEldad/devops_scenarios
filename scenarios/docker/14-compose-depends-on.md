# `depends_on` did not wait for the database

## Briefing

`docker compose up` starts the database and the API. The API crashes immediately with
a connection error, then Compose restarts it, and after two or three attempts it
works.

The Compose file says `depends_on: [db]`. Someone has concluded that `depends_on` is
broken. It is doing exactly what it documents — the assumption about what that means
is wrong.

## Your Task

- Bring the stack up from scratch and observe the API failing before succeeding.
- Establish what `depends_on` actually guarantees.
- Make the API start only when the database can accept connections.
- Add the second layer of protection the application needs regardless.

## Starter Files

### file: api.py

```python
import os
import socket
import sys
import time

host = os.environ.get("DB_HOST", "db")
port = int(os.environ.get("DB_PORT", "5432"))

s = socket.create_connection((host, port), timeout=3)
s.close()
print(f"connected to {host}:{port}", flush=True)

while True:
    time.sleep(10)
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY api.py .
CMD ["python", "api.py"]
```

### file: docker-compose.yml

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: orders

  api:
    build: .
    depends_on:
      - db
    environment:
      DB_HOST: db
      DB_PORT: "5432"
    restart: on-failure
```

## Expected Failure

```bash
docker compose down -v
docker compose up --build
```

```
db-1   | The files belonging to this database system will be owned by "postgres"...
api-1  | Traceback (most recent call last):
api-1  |   File "/srv/api.py", line 10, in <module>
api-1  |     s = socket.create_connection((host, port), timeout=3)
api-1  | ConnectionRefusedError: [Errno 111] Connection refused
api-1 exited with code 1
api-1  | Traceback ...
api-1 exited with code 1
db-1   | database system is ready to accept connections
api-1  | connected to db:5432
```

Postgres takes several seconds to initialise. `depends_on` started the API as soon as
the database **container** existed, which is long before the database **process** was
ready. Without `restart: on-failure` masking it, this would be a hard startup failure.

## Expected Outcome

The API starts once and connects on the first attempt.

```bash
docker compose down -v
docker compose up --build
```

```
db-1   | database system is ready to accept connections
api-1  | connected to db:5432
```

There must be **no** connection error and no restart in the output.

The API container has exactly one start:

```bash
docker compose ps
# NAME    STATUS
# api-1   Up 30 seconds
# db-1    Up 35 seconds (healthy)

docker inspect "$(docker compose ps -q api)" --format '{{.RestartCount}}'
# 0
```

The database reports a health state:

```bash
docker compose ps db
# STATUS: Up 40 seconds (healthy)
```

**The application also survives the database going away**, which ordering alone cannot
provide. Restart the database under a running API and confirm the API recovers rather
than crashing:

```bash
docker compose restart db
sleep 15
docker compose ps api
# still Up, no restart
```

## Hints

### Hint 1 — `depends_on` orders starts, nothing more

In its short form, `depends_on` guarantees only that Compose *starts* `db` before it
starts `api`. It does not wait for the process inside to be listening, initialised, or
willing to accept a connection.

For anything with a real startup sequence — databases, message brokers, search engines
— the gap between "container started" and "service ready" is seconds to minutes.

### Hint 2 — Combine a healthcheck with `condition: service_healthy`

```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres -d orders"]
    interval: 2s
    timeout: 3s
    retries: 15
    start_period: 5s

api:
  depends_on:
    db:
      condition: service_healthy
```

Now Compose waits for the healthcheck to pass. `start_period` gives the container a
grace window during which failing checks do not count against `retries`, which is what
you want for a slow initial startup.

And separately: the application should retry its own connection, because a dependency
can disappear at any time after startup, not only before it.

## Solution

`depends_on` in short form orders container starts and nothing else. Add a healthcheck
and make the API wait on it — then make the API resilient anyway.

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: orders
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d orders"]
      interval: 2s
      timeout: 3s
      retries: 15
      start_period: 5s

  api:
    build: .
    depends_on:
      db:
        condition: service_healthy
    environment:
      DB_HOST: db
      DB_PORT: "5432"
```

```python
import os
import socket
import sys
import time

HOST = os.environ.get("DB_HOST", "db")
PORT = int(os.environ.get("DB_PORT", "5432"))
DEADLINE = time.monotonic() + 60


def wait_for_db():
    delay = 0.5
    while time.monotonic() < DEADLINE:
        try:
            socket.create_connection((HOST, PORT), timeout=3).close()
            return True
        except OSError as exc:
            print(f"waiting for {HOST}:{PORT} ({exc})", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 5)
    return False


if not wait_for_db():
    print(f"database unreachable after 60s", file=sys.stderr)
    sys.exit(1)

print(f"connected to {HOST}:{PORT}", flush=True)
while True:
    time.sleep(10)
```

- **`depends_on` orders starts; healthchecks describe readiness.** They answer different
  questions, and only the combination gives you dependency management.
- **`start_period` is the field people miss.** Without it, a slow-starting service
  exhausts its retries during normal startup and is marked unhealthy before it ever had
  a chance.
- **Retry in the application regardless.** Startup ordering only helps at startup. In
  production the database will restart, fail over, or briefly drop connections while
  your service is already running, and only client-side retry with backoff handles that.
  This is also why Kubernetes has no `depends_on` at all — it expects applications to
  tolerate missing dependencies and simply restarts them.
- **`restart: on-failure` was hiding the problem**, turning a startup bug into a slow,
  noisy, eventually-successful boot. Crash loops that resolve themselves are still bugs.
