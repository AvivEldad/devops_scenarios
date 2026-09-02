# The cron job that runs and does nothing

## Briefing

The nightly backup has not produced a file in eleven days. Nobody noticed, because
nothing failed — there were no alerts, no error emails, and no entries in any log.

Run the script by hand and it works perfectly. Under cron it produces nothing at all.
The person who set it up has tried "adding more logging" twice and still has no
output to look at.

This is the classic shape of a cron problem: the job is not broken, the *environment*
is, and cron is exceptionally good at hiding evidence.

## Your Task

Install the crontab and the script as given, then make the job actually produce
backups on schedule.

1. Get evidence of what cron is doing. You cannot fix what you cannot see.
2. Find all three faults.
3. Make the job produce a timestamped backup file every minute (a fast schedule for
   the exercise) and leave a log you could hand to someone else.

```bash
mkdir -p ~/breakfix/linux-03 && cd ~/breakfix/linux-03
```

> If no cron daemon is available on your machine, you can still complete this. See
> hint 2 — reproducing cron's environment with `env -i` is the better debugging
> technique anyway, and it is what you should reach for even when cron does work.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Installs the broken backup job.
set -euo pipefail

LAB="$HOME/breakfix/linux-03/lab"
rm -rf "$LAB" && mkdir -p "$LAB/data" "$LAB/backups" "$HOME/.local/bin"

echo "customer records v1" > "$LAB/data/customers.csv"
echo "order records v1"    > "$LAB/data/orders.csv"

# a helper tool the team installed into their personal bin directory
cat > "$HOME/.local/bin/archive-tool" <<'EOF'
#!/usr/bin/env bash
# usage: archive-tool <source-dir> <target-file>
set -euo pipefail
tar -czf "$2" -C "$1" .
echo "archived $1 -> $2"
EOF
chmod +x "$HOME/.local/bin/archive-tool"

cat > "$LAB/backup.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
archive-tool data "backups/backup-$STAMP.tar.gz"
echo "backup complete: backup-$STAMP.tar.gz"
EOF
chmod +x "$LAB/backup.sh"

# install the crontab entry (this replaces your crontab -- see note below)
crontab -l > /tmp/crontab.backup 2>/dev/null || true
echo "NOTE: your previous crontab was saved to /tmp/crontab.backup"

cat <<EOF | crontab -
* * * * * cd $LAB && ./backup.sh --stamp \$(date +%Y%m%d)
EOF

echo "Installed. Current crontab:"
crontab -l
echo
echo "Working by hand:"
cd "$LAB" && ./backup.sh && ls backups/
```

## Expected Failure

Run the setup. The manual run succeeds and creates a backup:

```bash
bash setup.sh
# archived data -> backups/backup-20260831-104501.tar.gz
# backup complete: backup-20260831-104501.tar.gz
```

Now wait two minutes and look:

```bash
sleep 120
ls -l ~/breakfix/linux-03/lab/backups/
# only the file you created by hand
```

Nothing new. No error anywhere you would normally look:

```bash
ls /var/log/cron* /var/log/syslog 2>/dev/null    # may not even exist or be readable
mail                                             # "No mail" or command not found
```

The job is running every minute and failing silently, three times over.

## Expected Outcome

Cron produces backups on schedule and leaves an auditable trail.

New backup files appear over time without you doing anything:

```bash
ls -lt ~/breakfix/linux-03/lab/backups/ | head -5
# several backup-YYYYmmdd-HHMMSS.tar.gz files, roughly a minute apart
```

Wait two minutes and confirm the count increased:

```bash
before=$(ls ~/breakfix/linux-03/lab/backups/ | wc -l); sleep 130
after=$(ls ~/breakfix/linux-03/lab/backups/ | wc -l)
echo "$before -> $after"     # after must be greater
```

The log file exists and records both success and failure:

```bash
tail -5 ~/breakfix/linux-03/lab/cron.log
# backup complete: backup-20260831-104701.tar.gz
```

The archives are real and restorable, not empty:

```bash
latest=$(ls -t ~/breakfix/linux-03/lab/backups/*.tar.gz | head -1)
tar -tzf "$latest"
# ./
# ./customers.csv
# ./orders.csv
```

And the crontab entry is correct:

```bash
crontab -l
# the percent signs must be escaped, and stdout+stderr must be redirected to a log
```

## Hints

### Hint 1 — Cron's output goes to mail, and mail does not exist

By default cron mails any output of a job to the user. On virtually every modern
server there is no mail transport agent installed, so the output is generated and
then discarded. That is the silence.

Before diagnosing anything else, capture the output. Append this to the cron command:

```
>> /path/to/cron.log 2>&1
```

`2>&1` must come *after* the redirect, because it means "make stderr point wherever
stdout currently points". Reversed, stderr still goes to the old destination.

You can also check whether the daemon believes it ran the job at all:

```bash
grep CRON /var/log/syslog | tail        # Debian/Ubuntu
journalctl -u cron --since "10 min ago" # systemd
journalctl -u crond --since "10 min ago"
```

### Hint 2 — Reproduce cron's environment instead of guessing

Cron does not read `.bashrc`, `.bash_profile` or `/etc/profile`. It runs your command
with a nearly empty environment and a minimal `PATH`, usually
`/usr/bin:/bin`.

Compare:

```bash
echo "$PATH"                                   # your interactive PATH
env -i /bin/sh -c 'echo "$PATH"'               # roughly what cron gives you
```

Then run the job the way cron will:

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh -c 'cd ~/breakfix/linux-03/lab && ./backup.sh'
```

This single command reproduces most cron failures on demand, without waiting for a
schedule. Whatever error it prints is the error cron has been throwing away.

### Hint 3 — Percent has a special meaning in crontab

Look closely at the installed crontab line:

```
* * * * * cd /path && ./backup.sh --stamp $(date +%Y%m%d)
```

In a crontab, an unescaped `%` is **not** a literal percent. The first one terminates
the command, and everything after it is fed to the command as standard input, with
each subsequent `%` becoming a newline.

So cron does not run what you think it runs. Test what the command actually is, and
escape them with a backslash when you need a literal `%`. Better still, keep `date`
formatting inside the script — which this script already does — so the crontab line
stays simple.

### Hint 4 — PATH explains "command not found"

Once output is captured you will see something like:

```
./backup.sh: line 5: archive-tool: command not found
```

`archive-tool` lives in `~/.local/bin`, which your login shell adds to `PATH` and
cron does not. Two robust fixes: set `PATH=` explicitly at the top of the crontab, or
call the tool by absolute path in the script. Scripts that will run unattended should
never depend on an interactive shell's `PATH`.

Also confirm the working directory. Cron starts jobs in `$HOME`, so every relative
path in a script resolves from there unless the job or script does its own `cd`.

## Solution

Three faults, and the first one has to be fixed before you can see the other two.

**Fault 1 — output was discarded**, so every failure was invisible.

**Fault 2 — the unescaped `%`** truncated the command. Cron actually executed
`cd /path && ./backup.sh --stamp $(date +` and passed `Y%m%d)` as stdin, so the
command was malformed.

**Fault 3 — `archive-tool` is not on cron's `PATH`**, because `~/.local/bin` is added
by the interactive shell profile, which cron never reads.

Fix the script to be independent of the caller's environment:

```bash
#!/usr/bin/env bash
set -euo pipefail

# resolve paths relative to the script, never to the caller's cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups

echo "[$(date -Is)] starting backup"
archive-tool data "backups/backup-$STAMP.tar.gz"
echo "[$(date -Is)] backup complete: backup-$STAMP.tar.gz"
```

Fix the crontab entry:

```bash
crontab -e
```

```
PATH=/home/YOU/.local/bin:/usr/local/bin:/usr/bin:/bin
MAILTO=""

* * * * * /home/YOU/breakfix/linux-03/lab/backup.sh >> /home/YOU/breakfix/linux-03/lab/cron.log 2>&1
```

Verify without waiting for the schedule:

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh -c '/home/YOU/breakfix/linux-03/lab/backup.sh'
sleep 130
tail -5 ~/breakfix/linux-03/lab/cron.log
ls -lt ~/breakfix/linux-03/lab/backups/ | head
```

The rules that prevent every cron problem you will meet:

- **Always redirect output.** `>> /path/log 2>&1` on every entry. A job whose output
  you cannot read is a job you cannot operate.
- **Use absolute paths everywhere** — for the script, for the tools it calls, and for
  the files it touches. Cron's cwd is `$HOME`, not where the script lives.
- **Set `PATH` explicitly** in the crontab or the script, and never assume a profile
  was sourced.
- **Escape `%` or avoid it.** This one bites everybody once.
- **Test with `env -i`** rather than by waiting for the schedule.
- **Alert on absence.** The reason this ran unnoticed for eleven days is that nothing
  watched for backups *not* appearing. A job that fails silently and a job that never
  ran look identical from the outside, so monitor the freshness of the output rather
  than the exit code of the job.

For anything important, systemd timers are worth preferring over cron: output goes to
the journal automatically, `systemctl status` shows the last run and its exit code,
and `OnFailure=` can trigger an alert unit.

## What You Learned

The reason this took eleven days to notice is the reason it is worth practising: the
failure produced no signal anywhere. Cron generated three separate errors a minute
and threw all of them away, so "adding more logging" to the script accomplished
nothing — the logging was working fine and going to the same void.

The generalisable move is to fix observability before you fix behaviour. When a
scheduled or background job misbehaves, your first change should be the one that
makes its output visible, and only then do you start diagnosing. The `env -i`
technique is the second half of that: rather than reasoning about how an unattended
environment differs from yours, reproduce it and let the error tell you.
