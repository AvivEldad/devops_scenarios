# Exit code 0 on a pipeline that failed

## Briefing

The integration test stage has been green for three weeks. This morning someone
noticed the test report it publishes has been empty the whole time.

The stage runs a test suite, extracts a failure count from the log, and gates the
deploy on that number. The test binary was renamed in a refactor, so the suite has
not actually run since. Every stage in the chain failed, and the job still reported
success — because of how the shell computes the exit status of a pipeline.

## Your Task

Save the script, run it, and make it impossible for this to happen again.

1. Confirm the script exits `0` while every command inside it fails.
2. Explain precisely which exit code the shell used and why.
3. Fix it so that any failure in the chain fails the job, with a message naming what
   went wrong.

The gate must still work normally when the tests do run.

```bash
mkdir -p ~/breakfix/bash-02 && cd ~/breakfix/bash-02
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

rm -rf lab && mkdir lab && cd lab

# the test runner, under its NEW name after the refactor
cat > run-integration-tests.sh <<'EOF'
#!/usr/bin/env bash
echo "running 42 integration tests"
echo "PASS: 40"
echo "FAIL: 2"
echo "FAILURES: 2"
exit 1
EOF
chmod +x run-integration-tests.sh

echo "sandbox ready in $(pwd)"
ls
```

### file: ci-gate.sh

```bash
#!/usr/bin/env bash
# CI stage: run integration tests and gate the deploy on the failure count.
set -e

echo "== integration tests =="

# NOTE: this still calls the old script name from before the refactor
./run-tests.sh > test-output.log

FAILURES=$(cat test-output.log | grep "FAILURES:" | awk '{print $2}')

echo "failure count: $FAILURES"

if [ "$FAILURES" -gt 0 ] 2>/dev/null; then
  echo "GATE: blocking deploy"
  exit 1
fi

echo "GATE: tests passed, proceeding to deploy"
```

## Expected Failure

```bash
bash setup.sh
cd lab
cp ../ci-gate.sh .
bash ci-gate.sh; echo "exit=$?"
```

```
== integration tests ==
ci-gate.sh: line 8: ./run-tests.sh: No such file or directory
failure count:
GATE: tests passed, proceeding to deploy
exit=0
```

Read that carefully. The test runner does not exist, the log is empty, the failure
count is an empty string, and the script's conclusion is **"tests passed, proceeding
to deploy"** with exit `0`.

Even the `set -e` at the top did not save it. Three separate shell behaviours combine
here, and each one individually is defensible — which is why this pattern survives
code review so easily.

## Expected Outcome

Every failure mode must produce a non-zero exit and a message that names the cause.

A missing test runner fails the job:

```bash
bash ci-gate.sh; echo "exit=$?"
```

```
== integration tests ==
error: test runner ./run-tests.sh not found or not executable
exit=2
```

Point it at the correct script. Now the tests genuinely fail, and the gate blocks:

```bash
sed -i 's|./run-tests.sh|./run-integration-tests.sh|' ci-gate.sh
bash ci-gate.sh; echo "exit=$?"
```

```
== integration tests ==
running 42 integration tests
PASS: 40
FAIL: 2
failure count: 2
GATE: blocking deploy (2 failures)
exit=1
```

A log with no `FAILURES:` line is treated as an error, never as zero:

```bash
printf 'running tests\nsomething odd happened\n' > test-output.log
# with the runner stubbed to succeed and emit that log:
# error: could not parse failure count from test-output.log
# exit=2
```

A clean run passes:

```bash
cat > run-integration-tests.sh <<'EOF'
#!/usr/bin/env bash
echo "running 42 integration tests"
echo "FAILURES: 0"
exit 0
EOF
bash ci-gate.sh; echo "exit=$?"
# failure count: 0
# GATE: tests passed, proceeding to deploy
# exit=0
```

The test output is still visible in the job log, not hidden in a file:

```bash
bash ci-gate.sh 2>&1 | grep -c "running 42 integration tests"
# 1
```

And ShellCheck is clean:

```bash
shellcheck ci-gate.sh && echo "shellcheck clean"
```

## Hints

### Hint 1 — A pipeline's exit status is the status of its last command

This is the core of it:

```bash
false | true;    echo $?     # 0
cat missing | grep x | wc -l; echo $?     # 0
```

`wc -l` succeeded, so the pipeline succeeded, regardless of `cat` failing. `set -e`
looks at the *pipeline's* status, sees zero, and does not trigger.

`set -o pipefail` changes this: the pipeline returns the status of the rightmost
command that failed, or zero if none did.

```bash
set -o pipefail
cat missing | grep x | wc -l; echo $?     # 1
```

Try both in your shell before reading on. It is a two-line experiment that explains
three weeks of green builds.

### Hint 2 — Command substitution hides failures too

```bash
FAILURES=$(cat test-output.log | grep "FAILURES:" | awk '{print $2}')
```

An assignment's exit status is the status of the *assignment*, not of the command
substitution inside it. So even with `pipefail`, this line does not trip `set -e`.

Two ways out: check the value afterwards, or split the assignment from the
declaration. Note that `local x=$(cmd)` has the same trap and is worth knowing about,
since `local` is itself a command that succeeds.

### Hint 3 — That `2>/dev/null` is suppressing your only warning

```bash
if [ "$FAILURES" -gt 0 ] 2>/dev/null; then
```

With `FAILURES` empty, `[ "" -gt 0 ]` is a syntax error — bash would tell you
`integer expression expected`. The redirect hides the message, and the failed test
sends control to the `else` branch, which announces success.

Suppressing stderr to make a warning go away is almost always converting a loud
problem into a silent one.

### Hint 4 — An empty result is not zero

The deeper bug is treating "I could not determine the failure count" as "there were
no failures". A gate must fail closed: if it cannot prove the tests passed, it blocks.

Validate that the extracted value is actually a number before comparing:

```bash
[[ "$FAILURES" =~ ^[0-9]+$ ]] || { echo "error: ..." >&2; exit 2; }
```

### Hint 5 — Useless use of cat, and why it matters here

`cat file | grep pattern` spawns a process for nothing; `grep pattern file` is
equivalent. Beyond tidiness, the shorter form means fewer pipeline stages whose exit
codes you have to reason about — and `grep` on a missing file reports the error
itself instead of hiding behind `cat`.

## Solution

Three shell behaviours conspired: pipeline exit status comes from the last command,
`set -e` does not fire inside a command substitution assignment, and the stderr
redirect hid the comparison error. On top of those sits a design fault — the gate
failed open.

```bash
#!/usr/bin/env bash
# CI stage: run integration tests and gate the deploy on the failure count.
set -euo pipefail

RUNNER="./run-integration-tests.sh"
LOG="test-output.log"

echo "== integration tests =="

if [[ ! -x "$RUNNER" ]]; then
  echo "error: test runner $RUNNER not found or not executable" >&2
  exit 2
fi

# tee keeps the output in the CI log while still writing the file we parse.
# Without pipefail, a failing runner here would be masked by tee succeeding.
set +e
"$RUNNER" 2>&1 | tee "$LOG"
runner_status=${PIPESTATUS[0]}
set -e

if [[ ! -s "$LOG" ]]; then
  echo "error: $LOG is empty; the test runner produced no output" >&2
  exit 2
fi

FAILURES="$(grep -m1 '^FAILURES:' "$LOG" | awk '{print $2}' || true)"

if [[ ! "$FAILURES" =~ ^[0-9]+$ ]]; then
  echo "error: could not parse failure count from $LOG" >&2
  echo "       (runner exited with status $runner_status)" >&2
  exit 2
fi

echo "failure count: $FAILURES"

if (( FAILURES > 0 )); then
  echo "GATE: blocking deploy ($FAILURES failures)"
  exit 1
fi

if (( runner_status != 0 )); then
  echo "GATE: blocking deploy (runner exited $runner_status with no reported failures)"
  exit 1
fi

echo "GATE: tests passed, proceeding to deploy"
```

The pieces that matter:

- **`set -euo pipefail`** is the standard opening line for any script that runs
  unattended. `pipefail` is the one people omit and the one that caused this.
- **`${PIPESTATUS[0]}`** retrieves the exit code of a specific stage in the last
  pipeline. It is how you keep `tee` (so humans can see the output in the job log)
  without letting `tee`'s success mask the runner's failure. Capture it immediately —
  the array is overwritten by the very next command.
- **`grep ... || true`** is deliberate: with `set -e`, a `grep` that matches nothing
  exits `1` and would abort the script before you can produce a useful message. Here
  you want to handle the empty case yourself.
- **`(( FAILURES > 0 ))`** is arithmetic evaluation and is clearer than
  `[ "$x" -gt 0 ]` once you have already validated that the value is numeric.
- **Failing closed.** Every path that cannot prove success now exits non-zero, and
  the exit codes are distinguishable: `0` passed, `1` tests failed, `2` the gate could
  not do its job. In CI those are very different alerts.

A note on `set -e` in general: it has genuinely surprising exceptions. It does not
fire for a command in a condition (`if cmd`), for anything followed by `&&` or `||`,
for a function called in those positions, or inside a command substitution assignment.
Treat it as a useful safety net rather than a guarantee, and check what matters
explicitly.

## What You Learned

Three weeks of green builds came from three defaults behaving exactly as documented.
No line of this script was obviously wrong, and it passed review, which is the reason
this pattern is so widespread in CI configuration.

The transferable rule is that a gate must fail closed. When a check cannot determine
an answer, the only safe conclusion is to block. Anything that treats "unknown" as
"fine" will eventually spend weeks reporting success about a thing it never measured.
