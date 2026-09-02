# The background job I forgot to wait for

## Briefing

A script starts `backup &` and `compress &` then exits 0 immediately. Cron thinks
the job succeeded; the backups are half-written. Or `wait` is missing so `set -e`
never sees the child status. Or `wait -n` / `wait $pid` is the wrong pid because
`$!` was overwritten by the next `&`.

Job control in scripts is not optional if you background anything.

## Your Task

- Fire two background jobs and exit without `wait`; show the script status is 0
  while a child failed.
- Capture `$!` per job and `wait` with the right status.
- Fail the script if any child fails.

## Starter Files

### file: parallel.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
( sleep 1; echo backup ok ) &
( sleep 2; echo compress fail; exit 1 ) &
echo "script done"
# no wait
```

## Expected Failure

```bash
bash parallel.sh
echo "exit=$?"
# backup ok
# script done
# exit=0
# compress fail          <- may print after the shell already exited
```

The script's exit code was 0. The failed compressor did not count. Cron/CI green.

## Expected Outcome

The script waits for both and exits non-zero because compress failed.

```bash
bash parallel.sh
echo "exit=$?"
# backup ok
# compress fail
# exit=1
```

## Hints

### Hint 1 — Save $! immediately

```bash
backup &
bp=$!
compress &
cp=$!
wait "$bp"
wait "$cp"
```

`wait` with no args waits for all; its status is that of the **last** waited
job, not "any failed". Loop: `wait $pid || fail=1`.

### Hint 2 — set -e and wait

`wait $pid` returning non-zero *does* trigger `set -e` if it is a simple
command. `wait` without args may not fail the way you think. Prefer explicit
pids.

## Solution

Record pids; wait; accumulate status.

```bash
#!/usr/bin/env bash
set -euo pipefail
fail=0
( sleep 1; echo backup ok ) &
bp=$!
( sleep 2; echo compress fail; exit 1 ) &
cp=$!
wait "$bp" || fail=1
wait "$cp" || fail=1
exit "$fail"
```

- **Exiting the script sends SIGHUP to children** (unless `disown`/`nohup`) —
  another way "background" work dies when the job "succeeds".
- **`wait -n` (bash 4.3)** waits for the next job to finish — useful for pools.
- **`set -m` / job control** in scripts is off by default; `%1` job specs may
  not work. Use pids.
- **GNU `parallel` / `xargs -P`** if the pattern is "N files". Raw `&` is for a
  handful of known jobs.
