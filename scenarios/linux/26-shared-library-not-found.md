# error while loading shared libraries

## Briefing

A binary that ran yesterday now fails to start: `error while loading shared libraries:
libfoo.so.1: cannot open shared object file: No such file or directory`. Or it starts but
loads the wrong version and crashes. The program itself is unchanged.

Dynamically linked programs resolve their shared libraries at startup via the dynamic linker,
which searches a defined set of paths (the cache built by `ldconfig`, plus `LD_LIBRARY_PATH`
and `RPATH`). A library that moved, was upgraded to a new soname, or lives in a path not on
the search list will not be found.

## Your Task

- Reproduce a "cannot open shared object file" (and/or a wrong-version load).
- Determine which library is missing and where the linker is looking.
- Make the binary find the correct library, the right way.

## Starter Files

### file: notes.md

```text
Symptoms:
  $ ./myapp
    ./myapp: error while loading shared libraries: libfoo.so.1:
    cannot open shared object file: No such file or directory

The library exists on disk (e.g. in /opt/foo/lib/libfoo.so.1) but the dynamic
linker does not search there. Or a package upgrade changed the soname
(libfoo.so.1 -> libfoo.so.2) and this binary still wants the old one.
```

## Expected Failure

```bash
./myapp
# ./myapp: error while loading shared libraries: libfoo.so.1: cannot open shared object file

# what does the binary need, and what is missing?
ldd ./myapp
# libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x...)
# libfoo.so.1 => not found                        <- the culprit
```

```bash
# where does the linker search, and is the lib in the cache?
ldconfig -p | grep libfoo
# (no output) -> libfoo is not in the linker cache
find / -name 'libfoo.so*' 2>/dev/null
# /opt/foo/lib/libfoo.so.1                         <- it exists, just not on the search path
```

`ldd` shows `libfoo.so.1 => not found`. The library exists under `/opt/foo/lib`, but that
directory is not in the dynamic linker's cache (`ldconfig -p`) or search path, so startup
fails before `main` runs. (A soname bump would instead show the binary needing `.so.1` while
only `.so.2` is installed.)

## Expected Outcome

The binary starts and links the correct library.

`ldd` resolves everything:

```bash
ldd ./myapp
# libfoo.so.1 => /opt/foo/lib/libfoo.so.1 (0x...)     <- found
# (no 'not found' lines)
```

It runs:

```bash
./myapp
# (runs normally)
```

The path is registered durably in the linker cache (not just via a temporary env var):

```bash
ldconfig -p | grep libfoo
# libfoo.so.1 (libc6,x86-64) => /opt/foo/lib/libfoo.so.1
```

## Hints

### Hint 1 — ldd and ldconfig tell you what and where

`ldd <binary>` lists required libraries and which resolve; `=> not found` names the missing
one. `ldconfig -p | grep <lib>` shows what is in the linker cache. The dynamic linker searches
(in order) `RPATH`/`RUNPATH` in the binary, `LD_LIBRARY_PATH`, the `ldconfig` cache
(`/etc/ld.so.cache`), then default dirs (`/lib`, `/usr/lib`). Find where your library is and
which of these it is (not) on.

### Hint 2 — Register the path properly; mind the soname

For a durable fix, add the library's directory to `/etc/ld.so.conf.d/*.conf` and run
`sudo ldconfig` to rebuild the cache. `LD_LIBRARY_PATH=/opt/foo/lib ./myapp` works for a quick
test but is a fragile habit (per-process, order-sensitive, a security concern for setuid). If
the problem is a soname change (`.so.1` vs `.so.2`), install the compatibility version or
rebuild the app against the new one — do NOT symlink `.so.2` to `.so.1`, since a soname bump
signals an incompatible ABI.

## Solution

Find the missing library, put its directory on the linker's search path via `ldconfig`, and
handle soname mismatches correctly.

```bash
# 1) identify what is missing and where it actually lives
ldd ./myapp | grep 'not found'
find / -name 'libfoo.so*' 2>/dev/null

# 2a) library present but path not searched -> register it durably
echo '/opt/foo/lib' | sudo tee /etc/ld.so.conf.d/foo.conf
sudo ldconfig
ldconfig -p | grep libfoo          # now cached
ldd ./myapp                        # resolves
./myapp

# 2b) quick test only (not a permanent fix):
LD_LIBRARY_PATH=/opt/foo/lib ./myapp

# 2c) soname mismatch (needs .so.1 but only .so.2 installed):
#     install the compat package (e.g. libfoo1) or rebuild myapp against .so.2.
#     Do NOT symlink .so.2 -> .so.1: the version bump means an incompatible ABI.
```

- **Shared libraries resolve at startup via the dynamic linker.** A missing or unfindable
  `.so` fails the program before `main`. `ldd` shows exactly which library is `not found`.
- **Know the search order**: binary `RPATH`/`RUNPATH` → `LD_LIBRARY_PATH` → `ldconfig` cache →
  default dirs. `ldconfig -p` shows the cache; that is where system libraries should live.
- **Register paths with `ldconfig`, not `LD_LIBRARY_PATH`.** Add a file under
  `/etc/ld.so.conf.d/` and run `ldconfig` for a durable, system-wide fix. `LD_LIBRARY_PATH` is
  fine for a one-off test but fragile and a security risk for privileged binaries.
- **A soname change means an ABI change.** `libfoo.so.1` → `libfoo.so.2` is intentional
  incompatibility; symlinking one to the other invites crashes. Install the matching
  compatibility library or rebuild the consumer against the new version.
- **The versioning has meaning**: `libfoo.so` (dev symlink) → `libfoo.so.1` (soname, ABI
  version) → `libfoo.so.1.2.3` (full release). Programs link against the soname so compatible
  minor updates drop in without relinking.
