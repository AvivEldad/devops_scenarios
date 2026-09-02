# sudo: command not found for a command that works without sudo

## Briefing

A command runs fine as your user, but `sudo mytool` reports `command not found` — or `sudo`
runs a *different* version than you expect. Meanwhile `sudo /full/path/mytool` works.

`sudo` resets the environment for safety, including `PATH`. It uses a restricted
`secure_path` compiled into the sudoers policy, not your interactive `PATH`. Tools in
`/usr/local/bin` or your home directory may not be on that path, so the bare name does not
resolve under sudo.

## Your Task

- Show a command that works as your user but is `command not found` under `sudo`.
- Explain how `sudo` changes `PATH` and the environment.
- Run it correctly under sudo without weakening security.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# a tool installed where your PATH includes it but sudo's secure_path may not
sudo_bindir="/usr/local/bin"
cat <<'EOF'
Reproduction:
  1) install a tool into a dir on YOUR PATH but likely not on sudo's secure_path,
     e.g. $HOME/.local/bin/deploytool
  2) run it directly:            deploytool           -> works
  3) run it via sudo by name:    sudo deploytool      -> command not found
  4) run it via sudo by path:    sudo $(command -v deploytool)  -> works
EOF
echo "your PATH:            $PATH"
echo "sudo's secure_path:   $(sudo sh -c 'echo "$PATH"' 2>/dev/null || echo '(needs sudo)')"
```

## Expected Failure

```bash
command -v deploytool
# /home/you/.local/bin/deploytool     <- on your PATH

sudo deploytool
# sudo: deploytool: command not found

# but by absolute path it runs:
sudo "$(command -v deploytool)"
# runs fine
```

```bash
# your PATH vs sudo's PATH differ:
echo "$PATH"
# ...:/home/you/.local/bin
sudo sh -c 'echo "$PATH"'
# /usr/sbin:/usr/bin:/sbin:/bin        <- secure_path, no /home/you/.local/bin
```

`sudo` does not use your `PATH`; it uses the `secure_path` from sudoers. The tool's
directory is not on that list, so the bare name is not found — even though it works as your
user and works under sudo by absolute path.

## Expected Outcome

The command runs under sudo by name (or is deliberately invoked by path).

The simplest robust fix — invoke by absolute path — works:

```bash
sudo /home/you/.local/bin/deploytool
# runs
```

Or `secure_path` includes the needed directory (admin change):

```bash
sudo sh -c 'echo "$PATH"'
# ...:/usr/local/bin   (now includes where the tool lives)
sudo deploytool
# runs
```

## Hints

### Hint 1 — sudo sanitises the environment on purpose

By default sudo runs with a reset environment and a fixed `secure_path` (see
`sudo grep secure_path /etc/sudoers` or `sudo -V | grep -i "secure path"`). This is a
security feature: it stops a compromised user PATH from tricking root into running a
malicious binary. Your `~/.bashrc` PATH does not apply.

### Hint 2 — Prefer absolute paths over widening secure_path

The safest fix is to call the tool by absolute path under sudo. If a directory genuinely
needs to be available to root commands, an admin can add it to `secure_path` in
`/etc/sudoers` (via `visudo`). Avoid `sudo env "PATH=$PATH" cmd` or `sudo -E` as habits —
they re-import your environment and undo the protection.

## Solution

`sudo` uses `secure_path`, not your `PATH`. Invoke by absolute path, or have an admin add
the directory to `secure_path`.

```bash
# simplest and safest:
sudo "$(command -v deploytool)"      # absolute path, resolved as your user first
# or literally:
sudo /home/you/.local/bin/deploytool

# admin option (only for dirs that should be on root's path), via: sudo visudo
#   Defaults secure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
```

- **`sudo` resets the environment and uses `secure_path`.** Your interactive `PATH` does not
  carry over, so bare names in non-standard directories fail under sudo while working for your
  user.
- **This is intentional security.** A fixed `secure_path` prevents PATH-injection attacks
  against root. Reaching for `sudo -E` or `sudo env PATH=$PATH` to "fix" it re-opens exactly
  that hole — avoid it as a reflex.
- **Absolute paths are the clean fix.** `sudo /full/path/cmd` is unambiguous and safe;
  `sudo "$(command -v cmd)"` resolves the path as your user, then runs it as root.
- **Widen `secure_path` only deliberately**, through `visudo`, for directories that should be
  part of root's trusted path (e.g. `/usr/local/bin`). Never make it include user-writable
  directories.
- **`sudo -l` shows what you may run** and which Defaults apply — useful when a command is
  denied or behaves unexpectedly under sudo.
