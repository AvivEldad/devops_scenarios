# The systemd service that will not start

## Briefing

`systemctl start app` returns to the prompt, but `systemctl status app` shows `failed`. Or
it starts and immediately dies, or it is stuck `activating`. You need to read what systemd
and the journal are telling you instead of guessing.

systemd records exactly why a unit failed: the exit code, the signal, the number of
restarts, and the process output in the journal. Most "won't start" problems are a wrong
`ExecStart` path, a missing working directory, a bad `Type=`, or a permission/environment
issue — all visible in `status` and `journalctl -u`.

## Your Task

- Install a broken unit and reproduce the failed start.
- Read the exact cause from `systemctl status` and `journalctl -u`.
- Fix the unit so it starts and stays running.

## Starter Files

### file: app.service

```ini
[Unit]
Description=Demo app
After=network.target

[Service]
# several classic mistakes:
Type=forking                       # but the app does NOT fork/daemonise -> systemd waits/misjudges
ExecStart=/usr/local/bin/app.sh    # path may not exist / not executable
WorkingDirectory=/opt/app          # directory may not exist
User=appuser                       # user may not exist
Restart=always
RestartSec=1                       # with a crash loop this hammers restarts

[Install]
WantedBy=multi-user.target
```

### file: app.sh

```bash
#!/usr/bin/env bash
# a normal foreground service (does NOT fork) - contradicts Type=forking above
set -euo pipefail
echo "app starting"
while true; do echo "tick $(date +%T)"; sleep 5; done
```

## Expected Failure

```bash
sudo cp app.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl start app
systemctl status app --no-pager
# ● app.service - Demo app
#    Active: failed (Result: exit-code)
#    Process: ExecStart=/usr/local/bin/app.sh (code=exited, status=203/EXEC)
```

```bash
journalctl -u app --no-pager -n 20
# app.service: Failed to locate executable /usr/local/bin/app.sh: No such file or directory
# app.service: Failed at step EXEC spawning /usr/local/bin/app.sh: No such file or directory
```

`status=203/EXEC` means systemd could not execute the `ExecStart` binary — wrong path, not
executable, or bad interpreter. Even after fixing the path, `Type=forking` on a foreground
process will misreport readiness, because systemd expects the start process to fork and
exit.

## Expected Outcome

The service starts and stays active.

```bash
systemctl status app --no-pager
# Active: active (running) since ...
#  Main PID: 4821 (app.sh)

journalctl -u app -n 5 --no-pager
# tick 14:03:11
# tick 14:03:16
```

The unit's type matches the process model, and paths/users exist:

```bash
systemctl show app -p Type,ExecStart,User,WorkingDirectory
# Type=simple
# ExecStart={ path=/opt/app/app.sh ; ... }
# User=appuser
# WorkingDirectory=/opt/app
```

## Hints

### Hint 1 — status + journal tell you the exact cause

`systemctl status <unit>` shows the result and an exit code; the codes are specific:
`203/EXEC` = cannot execute ExecStart (path/perms/interpreter), `200/CHDIR` = bad
WorkingDirectory, `217/USER` = unknown User, non-zero app exit = app itself failed.
`journalctl -u <unit> -e` shows the process output. Read both before changing anything.

### Hint 2 — Type must match how the process behaves

`Type=simple` (default): the ExecStart process *is* the service and stays in the foreground —
correct for most modern apps. `Type=forking`: the start command forks a daemon and exits (use
with `PIDFile=`). Declaring `forking` for a foreground process makes systemd mismanage
readiness and restarts. Fix paths/users too, and `daemon-reload` after every unit edit.

## Solution

Match `Type=` to the process, correct the paths/user, and reload before restarting.

```ini
[Unit]
Description=Demo app
After=network.target

[Service]
Type=simple                        # foreground process is the service
ExecStart=/opt/app/app.sh          # real, executable path
WorkingDirectory=/opt/app          # existing directory
User=appuser                       # existing user (create it, or use an existing one)
Restart=on-failure
RestartSec=5                        # back off; avoid hammering restarts

[Install]
WantedBy=multi-user.target
```

```bash
# make prerequisites real
sudo useradd -r -s /usr/sbin/nologin appuser 2>/dev/null || true
sudo mkdir -p /opt/app && sudo cp app.sh /opt/app/ && sudo chmod +x /opt/app/app.sh
sudo chown -R appuser: /opt/app

sudo cp app.service /etc/systemd/system/
sudo systemctl daemon-reload        # REQUIRED after editing units
sudo systemctl restart app
systemctl status app --no-pager
```

- **systemd names the cause precisely.** `status`/`journalctl -u` give an exit code and
  output. Learn the common ones — `203/EXEC`, `200/CHDIR`, `217/USER`, `226/NAMESPACE` — so
  the failure points you straight at the wrong directive.
- **`Type=` must match the process model.** `simple` for foreground apps (the vast majority);
  `forking` only for daemons that background themselves and write a `PIDFile`. A mismatch makes
  systemd misjudge readiness, dependencies, and restarts.
- **`daemon-reload` after every unit edit.** systemd caches unit files; without a reload your
  change is invisible and you will "fix" it repeatedly with no effect.
- **Make the unit's prerequisites real** — the `User`, `WorkingDirectory`, and `ExecStart`
  path must exist and have correct permissions before start. Most failures are one of these.
- **Tame restart loops.** `Restart=on-failure` with a sane `RestartSec` (and `StartLimit*`)
  prevents a broken service from hammering the machine while you diagnose it.
