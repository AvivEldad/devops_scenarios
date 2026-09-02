# The files everyone creates with the wrong permissions

## Briefing

A deploy user and a service on the same box need to share files in a directory, but files
created by one are unreadable (or unwritable) by the other. Someone "fixed" it with
`chmod -R 777` and now security is unhappy. New files keep coming out with the wrong mode.

Two mechanisms control the mode of *newly created* files: the process `umask` (which bits to
remove from the default) and, for shared directories, the setgid bit and default ACLs (which
control group ownership and inherited permissions). Fixing existing files does nothing if new
ones keep being created wrong.

## Your Task

- Reproduce files being created with a mode that blocks the other user/group.
- Explain how `umask`, group ownership, the setgid bit, and default ACLs interact.
- Make new files in the shared directory come out correct automatically — without `777`.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# a shared directory for group 'deploy'
sudo groupadd -f deploy
sudo mkdir -p /srv/shared
sudo chgrp deploy /srv/shared
sudo chmod 775 /srv/shared

echo "current umask: $(umask)"        # often 022 -> new files are 644, dirs 755
echo "create a file and inspect its group/mode:"
echo "   umask 022; touch /srv/shared/a.txt; ls -l /srv/shared/a.txt"
```

## Expected Failure

```bash
bash setup.sh
umask 022
touch /srv/shared/a.txt
ls -l /srv/shared/a.txt
# -rw-r--r-- 1 you  you  0 ... a.txt
#            ^ group is 'you', not 'deploy'; and group has no write bit
```

```bash
# another member of 'deploy' cannot write it:
# -rw-r--r-- means group can only READ; and the group is wrong anyway (your primary group)
```

Two problems: the new file's group is your *primary* group (not `deploy`), because the
directory lacks the setgid bit; and `umask 022` stripped the group write bit, so even the
right group could not write. Existing-file chmod would not prevent the next file from
repeating both mistakes.

## Expected Outcome

New files inherit the shared group and are group-writable, automatically.

The directory is setgid so new files inherit its group:

```bash
ls -ld /srv/shared
# drwxrws--- ... deploy ...     <- 's' in the group triad = setgid
```

New files come out with the shared group and group-write:

```bash
touch /srv/shared/b.txt
ls -l /srv/shared/b.txt
# -rw-rw---- 1 you deploy 0 ... b.txt     <- group 'deploy', group-writable
```

And this holds regardless of who creates them, without any `777`.

## Hints

### Hint 1 — umask sets the default mode of new files

`umask` removes bits from the base mode (666 for files, 777 for dirs). `022` → files 644,
dirs 755 (no group/other write). For a shared, group-writable directory you want `002` →
files 664, dirs 775 (group keeps write). Set it for the service (systemd `UMask=`) or the
shell session, not globally to something insecure.

### Hint 2 — setgid + group + (optional) default ACLs for inheritance

`chmod g+s <dir>` makes new files/subdirs inherit the *directory's* group instead of the
creator's primary group — essential for shared spaces. For finer control that does not depend
on each user's umask, set default ACLs: `setfacl -d -m g:deploy:rwx /srv/shared` so every new
entry grants the group rwx automatically. Combine correct group ownership, setgid, and either
`umask 002` or default ACLs.

## Solution

Set the shared group, add setgid so new files inherit it, and ensure group-write via umask or
default ACLs — never `777`.

```bash
# group ownership + setgid (new files inherit group 'deploy')
sudo chgrp deploy /srv/shared
sudo chmod 2775 /srv/shared          # leading 2 = setgid; 775 = rwxrwxr-x

# ensure group-write on new files: either set umask for the creators...
umask 002
touch /srv/shared/b.txt
ls -l /srv/shared/b.txt              # -rw-rw---- you deploy (with dir perms)

# ...or, robustly, default ACLs so it does not depend on each user's umask:
sudo setfacl -m   g:deploy:rwx /srv/shared      # access ACL for existing dir
sudo setfacl -d -m g:deploy:rwx /srv/shared     # DEFAULT ACL inherited by new entries
getfacl /srv/shared

# for a service, set the umask in the unit:  [Service]\nUMask=0002
```

- **New-file permissions come from `umask`, not from chmod of existing files.** Fixing modes
  after the fact is a treadmill; fix the creation-time defaults and the problem stops recurring.
- **`umask 022` blocks group write; `002` keeps it.** Choose per directory purpose: `022` for
  private/system files, `002` for genuinely shared, group-writable spaces. Set it on the process
  (systemd `UMask=`) so it is deterministic.
- **The setgid bit on a directory makes new entries inherit the directory's group**, instead of
  the creator's primary group — the missing piece in almost every "wrong group on shared files"
  problem. `chmod g+s` / mode `2xxx`.
- **Default ACLs make inheritance independent of each user's umask.** `setfacl -d -m
  g:group:rwx dir` guarantees new files grant the group access no matter who creates them —
  cleaner than relying on everyone setting `umask 002`.
- **`777` is not a fix, it is a finding.** It grants everyone write, including other tenants
  and compromised processes. Group ownership + setgid + ACLs achieve controlled sharing with far
  less exposure.
