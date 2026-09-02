# Arguments to `docker run` are being ignored

## Briefing

The image is supposed to accept a mode argument: `docker run importer --dry-run`
should do a dry run. It always does a full run instead.

Then a colleague tries `docker run importer bash` to get a shell for debugging, and
gets the importer again — with `bash` silently treated as data.

The Dockerfile combines `ENTRYPOINT` and `CMD` in a way that makes both behaviours
impossible.

## Your Task

- Run the image with an argument and confirm it is discarded.
- Try to get a shell in the container and confirm you cannot.
- Work out how `ENTRYPOINT` and `CMD` combine, then fix the image so arguments work
  and a shell is reachable.

## Starter Files

### file: importer.py

```python
import sys

args = sys.argv[1:]
dry_run = "--dry-run" in args

print(f"argv: {args}")
print(f"mode: {'dry run' if dry_run else 'FULL IMPORT (writes data)'}")
```

### file: Dockerfile

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY importer.py .

ENTRYPOINT ["python", "importer.py", "--full"]
CMD ["--verbose"]
```

## Expected Failure

```bash
docker build -t importer .
docker run --rm importer --dry-run
```

```
argv: ['--full', '--dry-run']
mode: FULL IMPORT (writes data)
```

The argument arrived, but `--full` is hard-coded ahead of it in the entrypoint, so the
program still runs a full import. Worse, `--dry-run` replaced `--verbose`, which is the
`CMD`, so you also silently lost the default.

Trying to debug is no better:

```bash
docker run --rm -it importer bash
# argv: ['--full', 'bash']
# mode: FULL IMPORT (writes data)
```

`bash` was passed to the importer as an argument. There is no way to get a shell
without overriding the entrypoint, and nothing about the image suggests that.

## Expected Outcome

Arguments must reach the program and the defaults must be overridable.

Default behaviour when no arguments are given:

```bash
docker run --rm importer
# argv: ['--verbose']
# mode: FULL IMPORT (writes data)
```

An argument replaces the default and takes effect:

```bash
docker run --rm importer --dry-run
# argv: ['--dry-run']
# mode: dry run
```

Multiple arguments work:

```bash
docker run --rm importer --dry-run --verbose
# argv: ['--dry-run', '--verbose']
# mode: dry run
```

A shell is reachable for debugging:

```bash
docker run --rm -it --entrypoint bash importer -c 'echo shell works'
# shell works
```

And the image can be inspected to understand its interface:

```bash
docker inspect importer --format 'entrypoint={{.Config.Entrypoint}} cmd={{.Config.Cmd}}'
# entrypoint=[python importer.py] cmd=[--verbose]
```

## Hints

### Hint 1 — `CMD` is the default arguments; `ENTRYPOINT` is the program

When both are present in exec form, the container runs `ENTRYPOINT + CMD` concatenated.
Arguments given to `docker run` **replace `CMD` entirely** and are appended to
`ENTRYPOINT`.

```
ENTRYPOINT ["python", "importer.py", "--full"]
CMD        ["--verbose"]

docker run img                 -> python importer.py --full --verbose
docker run img --dry-run       -> python importer.py --full --dry-run
```

So anything in `ENTRYPOINT` is unconditional and can never be overridden by a normal
`docker run`. `--full` does not belong there.

### Hint 2 — Keep `ENTRYPOINT` to the program, `CMD` to the defaults

```dockerfile
ENTRYPOINT ["python", "importer.py"]
CMD ["--verbose"]
```

Now the image behaves like a command-line tool: run it with no arguments and you get
sensible defaults; run it with arguments and they are used.

`--entrypoint` overrides the entrypoint, which is how you get a shell. Note the awkward
syntax — `--entrypoint` takes only the executable, and its arguments go after the image
name.

## Solution

`--full` was baked into `ENTRYPOINT`, where nothing can override it, and user arguments
were replacing the `CMD` defaults rather than adding to them.

```dockerfile
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /srv
COPY importer.py .

# the program
ENTRYPOINT ["python", "importer.py"]
# the default arguments, replaced by anything passed to docker run
CMD ["--verbose"]
```

```bash
docker run --rm importer                     # python importer.py --verbose
docker run --rm importer --dry-run           # python importer.py --dry-run
docker run --rm --entrypoint bash -it importer   # a shell
```

- **`ENTRYPOINT` is what the container *is*; `CMD` is what it does by default.** Put the
  executable in one and the overridable arguments in the other, and the image behaves
  like a well-mannered CLI tool.
- **`docker run` arguments replace `CMD` wholesale.** They do not merge with it, so a
  default you want always applied must live in the entrypoint — and then it can never
  be turned off. Choose deliberately.
- **Only `CMD` (no `ENTRYPOINT`)** makes the whole command overridable, which is right
  for general-purpose images where `docker run img bash` should work.
- **Shell form breaks all of this**, on top of breaking signals: `ENTRYPOINT python app.py`
  becomes `/bin/sh -c "python app.py"` and appended arguments are discarded entirely.
  Always use the JSON array form.
- **A wrapper entrypoint script is the common production pattern**: it performs setup,
  then `exec "$@"` to hand off to `CMD` as PID 1. The `exec` is essential, or you
  reintroduce the signal-handling problem.

```bash
#!/usr/bin/env bash
set -euo pipefail
# ... setup: wait for dependencies, render config, drop privileges ...
exec python importer.py "$@"
```
