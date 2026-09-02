# lastpipe, coproc, and the fifo that deadlocked

## Briefing

You need two-way communication with a child (`coproc` or a named pipe). The
script hangs forever: both sides are waiting on `read`/`write` because the FIFO
was opened for reading first (blocks until a writer), or `coproc` stdout filled
the pipe buffer and nobody is reading. `lastpipe` interacts with this by running
the last pipeline command in the current shell — changing who holds which fd.

Deadlocks in bash look like "the script froze with no CPU". `strace` shows
`wait` on `read`.

## Your Task

- Reproduce a FIFO open that blocks (open read-only with no writer).
- Start a coproc, fill output without reading, observe a hang (or avoid it).
- Open FIFOs read-write (`<>`) or use coproc with a reader loop.

## Starter Files

### file: fifo.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
fifo=$(mktemp -u)
mkfifo "$fifo"
echo "opening fifo for read (will block until a writer exists)..."
exec 3< "$fifo"
echo "never gets here unless something opens the fifo for write"
```

## Expected Failure

```bash
bash fifo.sh
# opening fifo for read ...
# (hangs — another terminal would need: echo hi > $fifo)
```

Coproc variant:

```bash
coproc CAT { cat; }
yes > "${COPROC[1]}"
# eventually blocks when the pipe buffer fills because CAT's stdin is fed
# but if you never read ${COPROC[0]}, CAT may still be waiting...
```

## Expected Outcome

The script does not hang: FIFO opened `<>`, or writer started first, or coproc
output is drained.

```bash
mkfifo "$fifo"
exec 3<>"$fifo"          # RDWR, does not block
echo hello >&3
read -r line <&3
echo "$line"
# hello
```

## Hints

### Hint 1 — POSIX fifo open rules

Opening a FIFO for read blocks until a writer opens it (and vice versa), unless
you use `O_RDWR` (`<>` in bash `exec`). That is the usual deadlock in init
scripts.

### Hint 2 — Pipe buffers are finite

~64KiB. A coproc that prints a lot must be read. `read -u ${COPROC[0]}` in a
loop. Close `"${COPROC[1]}"` when you have no more input so the child sees EOF.

## Solution

Open FIFOs read-write, or coordinate open order; drain coproc.

```bash
fifo=$(mktemp -u)
mkfifo "$fifo"
exec 3<>"$fifo"
printf '%s\n' ping >&3
read -r reply <&3

coproc JSON { jq -c .; }
printf '%s\n' '{"a":1}' >&"${COPROC[1]}"
exec {COPROC[1]}>&-
read -r out <&"${COPROC[0]}"
```

- **`coproc` is bash 4+** and the `COPROC` array is overwritten by the next
  coproc — one at a time unless you name it (`coproc NAME { ... }`).
- **`lastpipe`:** `shopt -s lastpipe` + `set +m` makes `cmd | read` keep `read`
  in this shell — useful, but it changes deadlock/fd stories in pipelines.
- **Always `trap` to `rm` the fifo** on EXIT; leftover FIFOs confuse the next
  run (`file exists`).
- **Prefer extra fds (`exec 3<>`) over nesting coprocs** until you have tested
  EOF behaviour.
