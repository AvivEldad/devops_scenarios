# Permission denied on a script you own

## Briefing

You wrote a small maintenance script, saved it, and ran it. The shell refuses:

```
bash: ./cleanup.sh: Permission denied
```

You own the file. You can read it, edit it, delete it. And the shell will not execute
it. Once you get past that, it fails again for a completely different reason that
produces an equally unhelpful message.

Every one of these failures is routine, and each has a distinct cause worth being
able to name.

## Your Task

Create the files exactly as given, then make `./cleanup.sh` run successfully.

You will hit three separate failures in sequence. Fix them one at a time, and be able
to explain each. Do not work around the problem by running `bash cleanup.sh` — the
script must be directly executable, because cron and systemd will invoke it that way.

```bash
mkdir -p ~/breakfix/linux-01 && cd ~/breakfix/linux-01
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Creates the broken script and its environment. Run: bash setup.sh
set -euo pipefail

rm -rf lab && mkdir lab && cd lab

# the script, saved without execute permission and with CRLF line endings
printf 'w#!/usr/bin/env bash\r\n' | tail -c +2 > cleanup.sh
printf 'set -euo pipefail\r\n' >> cleanup.sh
printf '\r\n' >> cleanup.sh
printf 'LOG_DIR="./logs"\r\n' >> cleanup.sh
printf 'ARCHIVE="./archive"\r\n' >> cleanup.sh
printf '\r\n' >> cleanup.sh
printf 'echo "archiving logs older than 7 days"\r\n' >> cleanup.sh
printf 'mkdir -p "$ARCHIVE"\r\n' >> cleanup.sh
printf 'find "$LOG_DIR" -name "*.log" -mtime +7 -print -exec mv {} "$ARCHIVE"/ \\;\r\n' >> cleanup.sh
printf 'echo "done"\r\n' >> cleanup.sh

chmod 644 cleanup.sh

# some log files, most of them old
mkdir -p logs
for i in 1 2 3; do
  : > "logs/app-$i.log"
  touch -d "30 days ago" "logs/app-$i.log"
done
: > logs/today.log

# the log directory is not writable by you
chmod 555 logs

echo "Created $(pwd)"
ls -l
ls -l logs
```

## Expected Failure

Run the setup, then try the script:

```bash
bash setup.sh
cd lab
./cleanup.sh
```

**Failure one:**

```
bash: ./cleanup.sh: Permission denied
```

Fix that, run again:

**Failure two:**

```
bash: ./cleanup.sh: /usr/bin/env: bad interpreter: No such file or directory
```

or on some systems the stranger variant:

```
: not found
```

Fix that, run again:

**Failure three:**

```
archiving logs older than 7 days
./logs/app-1.log
mv: cannot remove './logs/app-1.log': Permission denied
```

Three failures, three different subsystems: the file's permission bits, the file's
*contents*, and the directory's permissions.

## Expected Outcome

The script runs directly and completes without error.

It is executable by you:

```bash
ls -l cleanup.sh
# -rwxr-xr-x  1 you you ... cleanup.sh
```

It contains no carriage returns:

```bash
file cleanup.sh
# cleanup.sh: Bourne-Again shell script, ASCII text executable
# (must NOT say "with CRLF line terminators")

grep -c $'\r' cleanup.sh
# 0
```

It runs and exits zero:

```bash
./cleanup.sh
echo "exit=$?"
# archiving logs older than 7 days
# ./logs/app-1.log
# ./logs/app-2.log
# ./logs/app-3.log
# done
# exit=0
```

The work actually happened — three old logs moved, today's log untouched:

```bash
ls archive/
# app-1.log  app-2.log  app-3.log

ls logs/
# today.log
```

## Hints

### Hint 1 — Read the permission bits, do not guess them

```bash
ls -l cleanup.sh
stat -c '%A %U:%G %n' cleanup.sh
```

The first field is three groups of `rwx` for owner, group and others. `644` is
`rw-r--r--`: nobody has `x`. Ownership grants you the right to *change* the mode; it
does not grant execution by itself.

Prefer symbolic mode when you fix it — `chmod +x` says what you mean, whereas typing
`chmod 777` because it makes the error go away is how machines end up with
world-writable scripts.

### Hint 2 — "bad interpreter" is about invisible characters

The shebang line looks perfect. The problem is what follows it.

```bash
head -1 cleanup.sh | cat -A
# #!/usr/bin/env bash^M$
```

`cat -A` reveals control characters: `$` marks end of line and `^M` is a carriage
return. The kernel reads the shebang literally and tries to execute the interpreter
named `bash\r`, which does not exist. This is what happens to every script edited on
Windows or pasted through a tool that converts line endings.

Look at `dos2unix`, or do it with `sed` or `tr`.

### Hint 3 — Moving a file is a directory operation

The final error is the subtle one. You can read `logs/app-1.log`, and the file itself
is not the problem.

```bash
ls -ld logs
# dr-xr-xr-x  ... logs
```

Removing a file, renaming it, or creating one modifies the *directory's* contents,
so it requires write permission on the **directory**, not on the file. `mv` across
directories is a remove plus a create. Note also that the `x` bit on a directory
means "may traverse into it", which is why `r-x` still lets you list and read.

### Hint 4 — Why the script stopped at the first bad move

`set -euo pipefail` is in the script for good reason, and `-e` aborts on the first
failing command. That is correct behaviour: you want a maintenance job to stop rather
than continue in an unknown state. Do not remove it to make the error disappear.

## Solution

Three independent faults.

**Fault 1 — no execute bit.**

```bash
chmod +x cleanup.sh
ls -l cleanup.sh
```

`chmod +x` respects your umask and sets execute for owner, group and other as
appropriate. `chmod u+x` restricts it to you alone, which is the tighter choice for
anything holding credentials.

**Fault 2 — CRLF line endings.**

```bash
# any one of these
dos2unix cleanup.sh
sed -i 's/\r$//' cleanup.sh
tr -d '\r' < cleanup.sh > tmp && mv tmp cleanup.sh

file cleanup.sh
head -1 cleanup.sh | cat -A
```

**Fault 3 — the directory is not writable.**

```bash
ls -ld logs
chmod u+w logs
ls -ld logs
# drwxr-xr-x
```

Then run it:

```bash
./cleanup.sh
ls archive/ logs/
```

Two ideas that generalise well beyond this exercise.

**The permission model.** Every file has three sets of `rwx` for owner, group and
others, and for *directories* the bits mean something different from files: `r` lists
names, `w` creates and deletes entries, `x` traverses into it and accesses entries by
name. This is why a read-only directory still allows you to modify a file inside it
(you are changing the file, not the directory listing), while `rm` of that same file
is denied.

**Why `#!/usr/bin/env bash` rather than `#!/bin/bash`.** `env` searches `PATH`, so
the script finds bash wherever it is installed — relevant on systems where it lives
in `/usr/local/bin`. The trade-off is that it also picks up whichever bash comes
first in `PATH`, which is a small supply-chain consideration for privileged scripts.

## What You Learned

Three unrelated causes produced three terse messages, and none of them said what was
actually wrong. `Permission denied` did not mention the execute bit;
`bad interpreter` did not mention a carriage return; and the last one blamed a file
when the directory was at fault.

The habit that pays off is refusing to guess. `ls -l`, `stat`, `file` and `cat -A`
each take one second and turn a vague error into a fact. Reaching for `chmod 777`
instead is how you fix the symptom, learn nothing, and leave a security finding
behind.
