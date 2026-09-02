# The script cds and then I am still in the old directory

## Briefing

A helper `fetch.sh` does `cd /opt/app && git pull`. After it returns, your shell is
still in `$HOME`. You expected to be in `/opt/app`. Or a pipeline `cd "$d" &&
process | wc` runs `process` in the old directory because of a subshell on one
side of the pipe.

`cd` in a child process cannot change the parent's cwd. Scripts, pipelines, and
`( ... )` all spawn children.

## Your Task

- Run a script that `cd`s and confirm the caller cwd is unchanged.
- Find a pipeline where `cd` does not affect the next command.
- Use `cd` in the same shell (`source`, or `cd` in the caller) or pass paths
  without relying on cwd.

## Starter Files

### file: fetch.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /tmp
echo "fetch.sh cwd: $PWD"
pwd
```

### file: pipe.sh

```bash
#!/usr/bin/env bash
# cd on the left of a pipe is a subshell in bash
cd /tmp | true
echo "after pipe cd: $PWD"
```

## Expected Failure

```bash
pwd
# /home/you
bash fetch.sh
# fetch.sh cwd: /tmp
pwd
# /home/you                 <- unchanged

bash pipe.sh
# after pipe cd: /home/you  <- cd was in the pipe subshell
```

The script's `cd` worked — for the script.

## Expected Outcome

You can work in `/tmp` in the *current* shell when that is the goal, and scripts
that only need files use absolute paths so the caller cwd does not matter.

```bash
source fetch.sh
# or:  . ./fetch.sh
pwd
# /tmp
```

Pipeline without subshell `cd`:

```bash
cd /tmp && printf '%s\n' "$PWD"
```

## Hints

### Hint 1 — Scripts are children

`bash fetch.sh` / `./fetch.sh` cannot change your cwd. To change the interactive
shell, `source` the file or `cd` yourself. Tools like `pushd`/`popd` are also
per-process.

### Hint 2 — Pipes and `( )`

Both sides of `|` run in subshells (bash). `(cd /tmp && ls)` is an explicit
subshell — cwd reverts after `)`. `{ cd /tmp && ls; }` is *not* a subshell (group
command) — that `cd` sticks. `lastpipe` (`shopt -s lastpipe`) in bash 4.2+ can
run the last pipeline stage in the current shell.

## Solution

Do not expect a script to `cd` for you. Source it, or use paths.

```bash
# caller:
cd /tmp && git pull
# or in a function in the current shell:
fetch() { cd /tmp && git pull; }
```

```bash
# group command keeps cd (careful in functions):
{ cd /tmp && ls; }
```

- **Cwd is process state.** This is why makefiles and CI steps `cd` every job
  independently.
- **`cd` failures:** `cd "$d" || exit` — without `set -e`, a failed `cd` then
  `rm -rf .` is a horror story. Always check `cd`.
- **`OLDPWD` and `cd -`** only help in the same process.
- **Prefer `"$dir/file"` over `cd "$dir"`** in scripts you execute, so you do not
  care where the caller was.
