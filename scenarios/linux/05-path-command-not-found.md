# command not found, but the program is installed

## Briefing

You installed a tool — `which` finds it, the binary is on disk, it runs by full path — but
typing its name gives `command not found`. Or a script that works in your interactive
shell fails under cron/systemd with the same error.

The shell finds executables by searching the directories in `$PATH`. If the binary lives
somewhere not on `PATH` (or `PATH` is different in the non-interactive environment), the
name does not resolve even though the program is right there.

## Your Task

- Reproduce `command not found` for a program that clearly exists.
- Determine why the shell cannot find it by name.
- Make it resolve correctly, both interactively and in a minimal environment.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# install a "tool" into a directory that is NOT on the default PATH
mkdir -p "$HOME/.local/tools"
cat > "$HOME/.local/tools/mytool" <<'EOF'
#!/usr/bin/env bash
echo "mytool ran; PATH was: $PATH"
EOF
chmod +x "$HOME/.local/tools/mytool"
echo "installed to $HOME/.local/tools/mytool"
echo "current PATH: $PATH"
```

## Expected Failure

```bash
bash setup.sh
mytool
# bash: mytool: command not found

# but it exists and runs by full path:
~/.local/tools/mytool
# mytool ran; PATH was: /usr/local/sbin:/usr/local/bin:/usr/bin:/bin:...
```

```bash
echo "$PATH" | tr ':' '\n' | grep -q "$HOME/.local/tools" && echo on-path || echo NOT-on-path
# NOT-on-path
```

The binary is executable and works by absolute path. It is simply not in any directory the
shell searches, so the bare name `mytool` does not resolve.

## Expected Outcome

The command resolves by name.

`$HOME/.local/tools` is on `PATH`:

```bash
echo "$PATH" | tr ':' '\n' | grep "$HOME/.local/tools"
# /home/you/.local/tools
```

The command runs by name:

```bash
mytool
# mytool ran; PATH was: ...:/home/you/.local/tools

command -v mytool
# /home/you/.local/tools/mytool
```

It also resolves in a non-interactive shell (what cron/systemd use):

```bash
env -i bash -lc 'command -v mytool'   # after adding it to the login profile
```

## Hints

### Hint 1 — PATH is an ordered search list

`echo $PATH` shows colon-separated directories searched left to right. `command -v mytool`
tells you what (if anything) the name resolves to; `which` is similar but external. If the
binary's directory is not listed, the bare name never resolves — add the directory to PATH.

### Hint 2 — Interactive vs non-interactive PATH differ

Your interactive PATH comes from shell startup files; cron and systemd start with a minimal
PATH (often just `/usr/bin:/bin`). Export PATH in the right file
(`~/.profile`/`~/.bashrc` for login shells), or set it explicitly in the crontab/unit. Test
with `env -i` to simulate a clean environment. When in doubt, call tools by absolute path in
automation.

## Solution

The tool's directory was not on `PATH`. Add it, persist it, and account for
non-interactive environments.

```bash
# for the current shell
export PATH="$HOME/.local/tools:$PATH"
command -v mytool          # now resolves

# persist for future login shells
echo 'export PATH="$HOME/.local/tools:$PATH"' >> ~/.profile

# for cron: set PATH at the top of the crontab, or call by absolute path
#   PATH=/usr/local/bin:/usr/bin:/bin:/home/you/.local/tools
# for systemd: Environment=PATH=... in the unit, or use ExecStart=/full/path
```

- **The shell resolves bare names via `$PATH`**, searched left to right. `command not found`
  means the name is in no listed directory — not that the program is missing. Prove it with
  `command -v`.
- **Prepending vs appending matters.** A directory earlier in PATH shadows later ones, so
  `export PATH="$HOME/.local/tools:$PATH"` lets your tool win over a system one of the same
  name (and vice versa). Order is a security consideration too.
- **Non-interactive PATH is minimal.** Cron and systemd do not read your `~/.bashrc`; they
  start with a bare PATH. Set PATH explicitly in the crontab/unit, or invoke commands by
  absolute path in automation.
- **`which` vs `command -v` vs `type`**: `command -v` is the portable, shell-builtin way to
  ask "what does this name resolve to?"; `type -a` shows all matches and whether it is an
  alias, function, or file.
- **Persist in the right file.** `~/.profile`/`~/.bash_profile` for login shells,
  `~/.bashrc` for interactive non-login — put PATH where the shells you actually use will
  read it.
