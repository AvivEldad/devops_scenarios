# Job control: SIGPIPE, yes | head, and a pipeline that lies

## Briefing

`set -euo pipefail` plus `yes | head -n 1` aborts: `yes` gets SIGPIPE and
returns 141, which `pipefail` treats as failure — even though `head` succeeded.
Or the opposite: without `pipefail`, `false | true` is success. Expert pipeline
status is `PIPESTATUS`, SIGPIPE 141, and whether you *want* early close to be
an error.

This is the expert sequel to the intermediate pipefail scenario: when pipefail
is *too* strict.

## Your Task

- Run `yes | head -n 1` with `pipefail` and show exit 141.
- Inspect `PIPESTATUS`.
- Mask SIGPIPE for "consumer closed early is OK" while still failing on real
  producer errors.

## Starter Files

### file: pipe.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
yes | head -n 1
echo "never reached"
```

## Expected Failure

```bash
bash pipe.sh
# y
# (exit 141)  — script aborted, "never reached" not printed
```

`head` closed the pipe; `yes` died on SIGPIPE. `pipefail` takes the rightmost
*non-zero*, which is 141.

## Expected Outcome

Printing one line is considered success; a real `false` in the producer still
fails.

```bash
set -euo pipefail
yes | head -n 1 || {
  st=("${PIPESTATUS[@]}")
  # allow 141 from producer
}
echo "ok"
```

Or `head ...; yes_status=${PIPESTATUS[0]}` without `set -e` on that line.

## Hints

### Hint 1 — 141 = 128+13 (SIGPIPE)

Commands that write to a closed pipe get SIGPIPE by default. `head`, `grep -q`,
`awk 'NR==1'` all close early. `pipefail` then fails the script. This is
correct for `curl | jq` when curl dies; noisy for `yes | head`.

### Hint 2 — PIPESTATUS is overwritten

Save it immediately: `ps=("${PIPESTATUS[@]}")` on the next line. `echo` would
reset it. `${PIPESTATUS[0]}` is the first command.

## Solution

```bash
#!/usr/bin/env bash
set -euo pipefail

ok_sigpipe() {
  "$@" || {
    local st=("${PIPESTATUS[@]}")
    local i
    for i in "${st[@]}"; do
      if ((i != 0 && i != 141)); then
        return "$i"
      fi
    done
    return 0
  }
}

ok_sigpipe yes \| head -n 1   # won't work — need a real pipeline inside the fn

yes | head -n 1 || {
  st=("${PIPESTATUS[@]}")
  (( st[0] == 0 || st[0] == 141 )) && (( st[1] == 0 ))
}
echo "ok"
```

Cleaner: do not use `yes | head` under `set -e`; use `head -n 1 <<< ...` or
`awk`.

- **`pipefail` is still the default you want.** Special-case SIGPIPE for known
  early-close consumers.
- **`grep -q` in a pipe** is the other classic 141. `grep -q pat || true` hides
  "not found" *and* SIGPIPE — too broad. Check `PIPESTATUS`.
- **`set +e` around one pipeline** is honest if the comment says why.
- **`lastpipe` does not fix SIGPIPE**; it only changes which process is the
  shell.
