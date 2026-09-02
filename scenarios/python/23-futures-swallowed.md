# Parallel rollouts: three nodes failed and the script printed SUCCESS

## Briefing

`rollout_parallel.py` uses `concurrent.futures.ThreadPoolExecutor` to
patch 50 nodes. A worker raises (`kubectl` failed, timeout). The parent
does `for _ in futures: pass` or `executor.map` without consuming the
iterator's exceptions, prints `SUCCESS`, exits 0. Some nodes moved, some
did not. The pipeline is green.

Python-03 is a single subprocess whose return code was ignored.
This is **fan-out**: exceptions live on the Future until `.result()` is
called. If you never call it, the process can still exit 0.

## Your Task

- Run the fan-out and show a worker failing while the parent exits 0.
- Wait for every future, collect failures, print them, exit non-zero if
  any failed.
- Do not cancel the honest successes; report both counts.

## Starter Files

### file: rollout_parallel.py

```python
#!/usr/bin/env python3
import sys
from concurrent.futures import ThreadPoolExecutor


def patch(node):
    print("patching %s" % node, flush=True)
    if node.endswith("03"):
        raise RuntimeError("%s: kubelet timeout" % node)
    return node + " ok"


def main():
    nodes = ["node-01", "node-02", "node-03", "node-04"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(patch, n) for n in nodes]
        # broken: never call future.result()
    print("SUCCESS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 rollout_parallel.py; echo exit=$?
# patching node-01
# patching node-02
# patching node-03
# patching node-04
# SUCCESS
# exit=0
```

Maybe a `Exception in thread` on stderr after SUCCESS, depending on
version — easy to miss in CI. The return code is still 0.

## Expected Outcome

```bash
python3 rollout_parallel.py; echo exit=$?
# patching ...
# ok: 3  failed: 1
# error: node-03: kubelet timeout
# exit=1
```

`SUCCESS` is not printed. node-01/02/04 still patched.

## Hints

### Hint 1 — Future.result() is where the raise happens

`as_completed(futs)` then `fut.result()`. An exception in a thread is
stored, not printed as a crash of the main process, until then.

### Hint 2 — executor.map

`list(pool.map(patch, nodes))` will raise on the first failure and skip
reporting the rest unless you iterate carefully. Prefer submit +
as_completed and collect.

## Solution

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

failed = []
ok = 0
with ThreadPoolExecutor(max_workers=4) as pool:
    futs = {pool.submit(patch, n): n for n in nodes}
    for fut in as_completed(futs):
        try:
            fut.result()
            ok += 1
        except Exception as exc:
            failed.append(str(exc))
print("ok: %d  failed: %d" % (ok, len(failed)))
if failed:
    for line in failed:
        print("error: %s" % line, file=sys.stderr)
    return 1
```

- **A thread exception is silent until `.result()`.**
- **`SUCCESS` after `with ThreadPoolExecutor`** only means the pool
  shut down.
- **Partial success is the common fan-out outcome** — count both, exit 1
  if the run was not complete.
- **`return_exceptions=True` in asyncio.gather** is the async cousin:
  you must still inspect the list.
