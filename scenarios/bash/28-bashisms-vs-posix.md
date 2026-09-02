# It works in bash and dies under /bin/sh

## Briefing

Ubuntu `/bin/sh` is dash. macOS `/bin/sh` is bash 3 in sh mode. Your script uses
`[[ ]]`, arrays, `source`, `local`, `function`, `pipefail`, or `echo -e`. The
shebang is `#!/bin/sh` because "that's portable". CI's `sh test.sh` fails;
your laptop `bash test.sh` passes.

Portability is a shebang and a dialect. Mixing them is the expert-mode on-call.

## Your Task

- Run a bash-ism script under `sh` and collect the errors.
- Either change the shebang to `bash` or rewrite the few lines to POSIX.
- Know which features are bash-only.

## Starter Files

### file: job.sh

```sh
#!/bin/sh
set -euo pipefail
arr=(a b)
source ./lib.sh
[[ -n $arr ]] && echo "${arr[1]}"
echo -e "line1\nline2"
```

### file: lib.sh

```sh
echo "lib loaded"
```

## Expected Failure

```bash
sh job.sh
# job.sh: 2: set: Illegal option -o pipefail
# job.sh: 3: Syntax error: "(" unexpected
# or: source: not found
# or: [[: not found
```

Dash rejects `pipefail`, arrays, `[[`. `source` is a bash synonym for `.`.
`echo -e` is not portable (use `printf`).

## Expected Outcome

Either:

```bash
head -1 job.sh
# #!/usr/bin/env bash
bash job.sh
# works
```

Or a POSIX rewrite that runs under `dash -e`.

```sh
#!/bin/sh
set -eu
# no pipefail: check pipeline by hand
. ./lib.sh
printf '%s\n' line1 line2
```

## Hints

### Hint 1 — Check the shebang against the syntax

If you need arrays/`[[`/`pipefail`/`local` in functions with bash semantics,
the shebang is `#!/usr/bin/env bash`. `checkbashisms` / ShellCheck will flag
`sh` + bash-isms.

### Hint 2 — POSIX replacements

`[[` → `[` with quotes. `source` → `.`. Arrays → multiple variables or
IFS-split with care. `pipefail` → `set -e` cannot replace it; use temp files
or `r=0; cmd || r=$?`. `echo -e` → `printf`. `function f {` → `f() {`.

## Solution

Pick a dialect and commit to it.

```bash
#!/usr/bin/env bash
set -euo pipefail
arr=(a b)
# shellcheck source=lib.sh
source ./lib.sh
[[ -n ${arr[1]-} ]] && printf '%s\n' "${arr[1]}"
printf 'line1\nline2\n'
```

- **CI should run `dash script` if you claim POSIX.** Testing only bash hides
  this class of bug.
- **Alpine `ash`** is another sh. BusyBox is smaller still.
- **`local` is not POSIX** but is in dash/ash as an extension. `declare` is not.
- **Document `bash 4+`** if you use `nameref` / `associative` / `mapfile`.
