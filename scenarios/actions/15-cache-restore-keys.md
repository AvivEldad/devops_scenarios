# restore-keys hit a cache from another OS

## Briefing

Cache saves minutes — except when it restores a **partial** key from
`restore-keys: ${{ runner.os }}-pip-` that was built on a different Python
version or with a stale `requirements.txt`. The job "succeeds" with a
poisoned cache: wrong wheels, macOS binaries on Linux (if the os prefix was
omitted). `actions/cache` hits are prefix matches on restore-keys, not
equality.

The beginner cache drill (actions-02) was a unique `run_id` that never hits.
This is the opposite: hits that are **too broad**.

## Your Task

- Read a cache step whose primary key is precise but `restore-keys` is only
  `runner.os`.
- Tighten restore-keys to include Python version and a file hash.
- Know when to `cache-hit != 'true'` and reinstall.

## Starter Files

### file: .github/workflows/ci.yml

```yaml
name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('requirements.txt') }}
          restore-keys: |
            ${{ runner.os }}-pip-
            ${{ runner.os }}-
      - run: pip install -r requirements.txt
      - run: pytest
```

## Expected Failure

```text
Cache restored from key: Linux-pip-   (old hash, old requirements)
pip install "nothing to do"
pytest ImportError / unexpected version
```

The last restore-key `${{ runner.os }}-` can restore **any** Linux cache
(node_modules, pip, cargo) if paths overlap — chaos.

## Expected Outcome

Restore only pip caches for this OS + python, preferably same requirements
prefix.

```yaml
key: ${{ runner.os }}-pip-3.12-${{ hashFiles('requirements.txt') }}
restore-keys: |
  ${{ runner.os }}-pip-3.12-
```

No bare `${{ runner.os }}-`. After restore, still run `pip install -r` so
missing packages fill in (pip cache, not a venv snapshot).

## Hints

### Hint 1 — restore-keys is prefix match, first hit wins

GitHub searches restore-keys in order. A short prefix matches more, including
stale. Primary `key` is exact. Prefer few, long restore-keys.

### Hint 2 — Path must match what you saved

Caching `~/.cache/pip` is not caching a venv. Caching `node_modules` across
OS is invalid. Include `runner.os` always; include ABI (python version,
glibc).

## Solution

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/pip
    key: ${{ runner.os }}-pip-3.12-${{ hashFiles('requirements.txt') }}
    restore-keys: |
      ${{ runner.os }}-pip-3.12-
```

- **`hashFiles` only sees files in the workspace** after checkout. Order
  steps correctly.
- **Lockfiles** (`poetry.lock`, `package-lock.json`) belong in the hash, not
  only `package.json`.
- **Poisoned cache:** bump a version suffix in the key (`-v2-`) to invalidate
  globally.
- **`save-always` / failed jobs** — caches from failed runs can still save;
  that can be good or can freeze a broken install.
