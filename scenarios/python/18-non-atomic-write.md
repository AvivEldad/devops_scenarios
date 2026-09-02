# The node went NotReady because we crashed while rewriting kubelet config

## Briefing

`write_state.py` updates a file other processes read: a Prometheus
textfile, `hosts.json`, a kubeconfig, an nginx map. It does
`open(path, "w")` which **truncates first**, then writes, then crashes
(OOM, SIGKILL, full disk). The reader sees a zero-byte or half JSON
file. The node looks empty. The last good config is gone.

The fix is write-to-tempfile-in-the-same-directory and `os.replace`,
which is atomic on the same filesystem.

## Your Task

- Truncate-and-crash (or kill -9) during a rewrite and show the dest file
  empty or invalid.
- Write to a sibling temp file and `os.replace`.
- Interrupt the writer and show the previous complete file still parses.

## Starter Files

### file: state.json

```json
{"healthy": true, "hosts": ["a", "b", "c"]}
```

### file: write_state.py

```python
#!/usr/bin/env python3
import json
import sys
import time


def main():
    path = "state.json"
    data = json.load(open(path))
    data["hosts"].append("d")
    fh = open(path, "w")          # truncated now
    if "--crash" in sys.argv:
        fh.write('{"healthy":')  # partial
        fh.flush()
        time.sleep(2)
        raise SystemExit("simulated crash after truncate")
    json.dump(data, fh)
    fh.write("\n")
    fh.close()
    print("updated", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 write_state.py --crash
# simulated crash after truncate
cat state.json
# {"healthy":
python3 -c "import json; json.load(open('state.json'))"
# JSONDecodeError
```

Readers (kubelet, node-exporter textfile, ansible) now fail. The previous
three-host document is unrecoverable.

## Expected Outcome

```bash
python3 write_state.py --crash
# (crash during write of the temp file)
cat state.json
# {"healthy": true, "hosts": ["a", "b", "c"]}     # previous good file

python3 write_state.py
python3 -c "import json; print(json.load(open('state.json')))"
# hosts includes d
```

## Hints

### Hint 1 — open(path, "w") is the truncate

The old bytes are gone before the new bytes exist. `os.replace(tmp, path)`
on the same filesystem is the usual atomic publish.

### Hint 2 — Same directory, not /tmp

`replace` is only atomic if src and dest are on one filesystem. `NamedTemporaryFile(dir=dest_dir)`
then `os.replace`. fsync the file before replace if a power loss matters.

## Solution

```python
import os
from tempfile import NamedTemporaryFile

dir_name = "."
with NamedTemporaryFile("w", dir=dir_name, delete=False, prefix="state.", suffix=".tmp") as fh:
    json.dump(data, fh)
    fh.write("\n")
    fh.flush()
    os.fsync(fh.fileno())
    tmp = fh.name
os.replace(tmp, "state.json")
```

- **Truncate-in-place is a crash bug**, not a style issue.
- **Prometheus textfiles, kubeconfigs, and nginx maps** are all read by
  something else while you write.
- **`os.replace`**, not `os.rename` on Windows; replace is the portable
  overwrite.
- **fsync** if this file is the last line of defence on power loss.
