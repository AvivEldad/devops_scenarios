# The environment variable with four possible values

## Briefing

A service is connecting to the production database from a developer's laptop. The
`.env` file says `staging`. The Compose file says `staging`. The Dockerfile says
`development`.

Something is winning that nobody listed, and until you know the precedence order you
cannot predict what any of these containers will do.

## Your Task

- Bring the stack up and record which value actually reaches the process.
- Work out the full precedence order by testing, not by guessing.
- Make the configuration unambiguous so the effective value is obvious from the files.

## Starter Files

### file: show.py

```python
import os

for key in ("APP_ENV", "DB_HOST", "LOG_LEVEL"):
    print(f"{key}={os.environ.get(key, '<unset>')}")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
ENV APP_ENV=development
ENV DB_HOST=db.dev.internal
ENV LOG_LEVEL=debug
WORKDIR /srv
COPY show.py .
CMD ["python", "show.py"]
```

### file: .env

```text
APP_ENV=staging
DB_HOST=db.staging.internal
```

### file: app.env

```text
APP_ENV=qa
LOG_LEVEL=info
```

### file: docker-compose.yml

```yaml
services:
  show:
    build: .
    env_file:
      - app.env
    environment:
      APP_ENV: ${APP_ENV}
      DB_HOST: db.prod.internal
```

## Expected Failure

```bash
docker compose run --rm show
```

```
APP_ENV=staging
DB_HOST=db.prod.internal
LOG_LEVEL=info
```

Three files, three different sources, and each variable came from a different one:

- `APP_ENV` came from `.env` — via `${APP_ENV}` interpolation in the Compose file
- `DB_HOST` came from the hard-coded `environment:` entry, pointing at **production**
- `LOG_LEVEL` came from `app.env`

The Dockerfile's `ENV` values lost every time. And a shell variable beats all of them:

```bash
APP_ENV=whatever docker compose run --rm show
# APP_ENV=whatever
```

Nothing in the repository indicates that a laptop would connect to
`db.prod.internal`, and nobody reviewing the `.env` file would spot it.

## Expected Outcome

The effective configuration must be predictable and verifiable.

**You can state the precedence order** and demonstrate it. Highest wins:

```bash
# 1. docker compose run -e
docker compose run --rm -e APP_ENV=cli show | grep APP_ENV
# APP_ENV=cli

# 2. shell environment, via ${VAR} interpolation
APP_ENV=shell docker compose run --rm show | grep APP_ENV
# APP_ENV=shell

# 3. environment: in the compose file
# 4. env_file:
# 5. .env file (only through interpolation)
# 6. ENV in the Dockerfile
```

**The effective values are inspectable before running anything:**

```bash
docker compose config
# shows the fully resolved configuration with all interpolation applied
```

**No environment points a developer at production:**

```bash
docker compose config | grep -i 'prod'
# (no output)
```

**A missing variable fails loudly rather than becoming an empty string:**

```bash
unset APP_ENV
docker compose config 2>&1 | grep -i 'warn\|required'
# a warning or error, not a silent empty value
```

**The defaults in the image still apply when nothing overrides them:**

```bash
docker run --rm "$(docker compose config --images | head -1)"
# APP_ENV=development
# DB_HOST=db.dev.internal
# LOG_LEVEL=debug
```

## Hints

### Hint 1 — There are six sources and they are strictly ordered

From highest precedence to lowest:

1. `docker compose run -e VAR=value`
2. the shell environment, where it is substituted into `${VAR}` in the Compose file
3. `environment:` in the Compose file
4. `env_file:`
5. the `.env` file — but **only** through `${VAR}` interpolation, not directly
6. `ENV` in the Dockerfile

The `.env` file is the most misunderstood: it does not inject variables into the
container. It supplies values for `${VAR}` substitution in the Compose file itself. A
variable in `.env` that is not referenced anywhere in the Compose file has no effect at
all.

### Hint 2 — `docker compose config` shows the resolved result

```bash
docker compose config
```

This prints the Compose file after all interpolation, merging and defaults, which is
exactly what will be applied. Run it before every unfamiliar `up` — it turns a guessing
game into reading.

Use `${VAR:?message}` to make a variable mandatory, and `${VAR:-default}` for a
default, so an unset value fails or falls back explicitly rather than silently becoming
an empty string.

## Solution

Three overlapping sources, silently resolved, with a hard-coded production hostname
that no file named after an environment would lead you to check.

Reduce it to one source of truth per environment, with required variables declared:

```yaml
services:
  show:
    build: .
    env_file:
      - ${ENV_FILE:?set ENV_FILE, e.g. env/staging.env}
    environment:
      # only values that are genuinely per-run belong here
      LOG_LEVEL: ${LOG_LEVEL:-info}
```

```text
# env/staging.env
APP_ENV=staging
DB_HOST=db.staging.internal
```

```text
# env/production.env
APP_ENV=production
DB_HOST=db.prod.internal
```

```bash
ENV_FILE=env/staging.env docker compose config     # verify first
ENV_FILE=env/staging.env docker compose up
```

- **Know the six sources and their order.** Most "the config is wrong and I cannot see
  why" incidents are two sources setting the same key, with the loser being the one
  someone edited.
- **`.env` is for interpolation into the Compose file, not for the container.** It is
  also loaded automatically from the current directory, so its contents can affect a
  stack without appearing in any file you are reading.
- **`docker compose config` before `up`.** It is the only way to see the effective
  configuration, and it takes two seconds.
- **Make required variables required**: `${DB_HOST:?DB_HOST must be set}` turns an
  empty-string bug into an immediate, readable failure — the same principle as the
  Python missing-environment scenario.
- **Never hard-code a production endpoint in a file that is loaded by default.** Select
  the environment explicitly, so connecting to production is something you have to ask
  for.
- **Keep `ENV` in the Dockerfile for safe defaults only.** It has the lowest precedence,
  so it is a good place for `LOG_LEVEL=info`, and a bad place for anything
  environment-specific.
