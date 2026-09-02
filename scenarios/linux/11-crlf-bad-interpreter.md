# bad interpreter: the script with invisible carriage returns

## Briefing

A shell script that looks perfect fails with `bad interpreter: No such file or directory`,
or `^M: command not found`, or simply `: not found`. The shebang line is correct and the
interpreter exists. The problem is a character you cannot see.

The file was saved with Windows-style CRLF line endings. The kernel reads the shebang
literally and tries to run the interpreter named `bash\r` (with a trailing carriage
return), which does not exist. Every line also carries a hidden `\r` that corrupts commands.

## Your Task

- Create a script with CRLF endings and reproduce the "bad interpreter" failure.
- Reveal the carriage returns and explain why they break execution.
- Convert the file to Unix line endings and prevent it recurring.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# write a script with CRLF endings (as if edited on Windows or pasted through a bad tool)
printf '#!/usr/bin/env bash\r\n' >  deploy.sh
printf 'set -euo pipefail\r\n'   >> deploy.sh
printf 'echo "deploying version 3"\r\n' >> deploy.sh
chmod +x deploy.sh
echo "created deploy.sh with CRLF line endings"
```

## Expected Failure

```bash
bash setup.sh
./deploy.sh
# bash: ./deploy.sh: /usr/bin/env: bad interpreter: No such file or directory
# (or)  ./deploy.sh: line 1: #!/usr/bin/env bash^M: not found
```

```bash
# reveal the hidden carriage returns:
head -1 deploy.sh | cat -A
# #!/usr/bin/env bash^M$      <- ^M is the carriage return, $ is end of line

file deploy.sh
# deploy.sh: Bourne-Again shell script, ASCII text executable, with CRLF line terminators
```

The shebang is `#!/usr/bin/env bash\r`. The kernel passes `bash\r` as the interpreter name
to `env`, which cannot find a program called `bash` followed by a carriage return — hence
"bad interpreter". `cat -A` makes the `^M` visible.

## Expected Outcome

The script runs and the file has Unix line endings.

No carriage returns remain:

```bash
grep -c $'\r' deploy.sh
# 0

file deploy.sh
# deploy.sh: Bourne-Again shell script, ASCII text executable
# (no "with CRLF line terminators")
```

It runs:

```bash
./deploy.sh
# deploying version 3
```

## Hints

### Hint 1 — Make the invisible visible

`cat -A file` shows `^M` for carriage return and `$` at each true line end;
`file file` reports "with CRLF line terminators"; `grep -c $'\r' file` counts them. Any of
these confirms CRLF. The error messages (`bad interpreter`, `^M: command not found`,
`: not found`) are all fingerprints of the same problem.

### Hint 2 — Convert, then prevent

Strip carriage returns with `dos2unix file`, or `sed -i 's/\r$//' file`, or
`tr -d '\r' < file > tmp && mv tmp file`. Prevent recurrence: set editors to LF, add a
`.gitattributes` with `*.sh text eol=lf`, and configure `git config core.autocrlf` sensibly
so checkouts do not reintroduce CRLF.

## Solution

The file had CRLF line endings. Convert to LF and guard against it returning.

```bash
# any one of these:
dos2unix deploy.sh
sed -i 's/\r$//' deploy.sh
tr -d '\r' < deploy.sh > deploy.tmp && mv deploy.tmp deploy.sh

file deploy.sh          # no CRLF
./deploy.sh             # deploying version 3

# prevent recurrence in git:
#   echo '*.sh text eol=lf' >> .gitattributes
#   git add --renormalize .
```

- **CRLF in the shebang breaks execution.** The kernel reads the interpreter path literally,
  so `bash\r` is "not found" — the infamous "bad interpreter". The line looks correct because
  the `\r` is invisible.
- **`cat -A`, `file`, and `grep $'\r'`** are the three quick tests. Learn to reach for `cat
  -A` whenever a "perfect" script fails inexplicably — hidden characters are a common cause.
- **CRLF corrupts every line, not just the shebang.** A trailing `\r` becomes part of
  variable values and arguments, causing subtle failures (paths with an appended carriage
  return) even when the script "runs".
- **Fix with `dos2unix`/`sed`/`tr`**, then prevent: enforce LF in your editor, add
  `.gitattributes` (`*.sh text eol=lf`), and set `core.autocrlf` appropriately so the next
  checkout or paste does not reintroduce it.
- **This bites cross-platform teams constantly** — files authored on Windows, pasted through
  chat tools, or mangled by a misconfigured editor. A repo-level `.gitattributes` is the
  durable fix.
