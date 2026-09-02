# The backup script works in the repo and writes nothing under cron

## Briefing

`backup.py` reads `./targets.txt` and writes `./backups/`. You run it from the
clone and get a tarball. Cron is installed as `*/15 * * * * python3 /opt/backup/backup.py`.
Cron's working directory is `/` (or `$HOME`), not `/opt/backup`. The job exits
with `FileNotFoundError: targets.txt` — or worse, with a catch that prints
`nothing to do` and exit 0, so nobody looks.

Linux-03 is cron PATH and environment. This one is **Python relative paths**.

## Your Task

- Reproduce the failure by running the script from a different directory.
- Anchor paths to the script file (or an explicit `BACKUP_ROOT`), not `cwd`.
- Confirm it works from `/tmp` the way cron would.

## Starter Files

### file: targets.txt

```
app.internal
db.internal
```

### file: backup.py

```python
#!/usr/bin/env python3
import sys
from datetime import datetime
from pathlib import Path


def main():
    targets = Path("targets.txt").read_text().split()
    out = Path("backups")
    out.mkdir(exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    dest = out / ("hosts-%s.txt" % stamp)
    dest.write_text("\n".join(targets) + "\n")
    print("wrote %s (%d hosts)" % (dest, len(targets)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
# from the directory that contains the files — looks fine
python3 backup.py
# wrote backups/hosts-....txt (2 hosts)

# the way cron runs it
cd /tmp && python3 /full/path/to/backup.py
# Traceback: FileNotFoundError: targets.txt
```

Relative `Path("targets.txt")` is relative to **cwd**, not to the `.py` file.

## Expected Outcome

```bash
cd /tmp && python3 /full/path/to/backup.py
# wrote /full/path/to/backups/hosts-....txt (2 hosts)
```

A second run from the repo directory still works. Cron and humans share one
code path.

## Hints

### Hint 1 — cwd is not the script

`Path(__file__).resolve().parent` is the directory the file lives in. Cron,
systemd `WorkingDirectory=`, and `python3 /opt/backup/backup.py` all disagree
with however you tested in the shell.

### Hint 2 — Do not hide FileNotFoundError

A bare `except Exception: print("nothing to do")` turns this into linux-03
(silent cron). Let the job fail, or log the absolute path you tried to open.

## Solution

Resolve against the script, or require an absolute root.

```python
ROOT = Path(__file__).resolve().parent
targets = (ROOT / "targets.txt").read_text().split()
out = ROOT / "backups"
```

```cron
# still better: set it explicitly
*/15 * * * * cd /opt/backup && /opt/backup/.venv/bin/python backup.py
```

- **Relative paths follow cwd.** Cron's cwd is not your repo.
- **`__file__` is the usual fix** for sidecar data next to the script.
- **systemd `WorkingDirectory=`** is the unit-file equivalent; still prefer
  absolute paths in code.
- **Test with `cd /tmp && python3 /path/to/script.py`** before you install
  the crontab.
