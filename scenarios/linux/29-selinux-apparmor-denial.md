# Permission denied, and the permissions are perfect

## Briefing

A process is denied access to a file or port, but `ls -l` shows the permissions are exactly
right, the user is correct, and it still fails. On a system with SELinux or AppArmor, the
discretionary permissions (owner/group/mode) are not the whole story — a mandatory access
control layer can deny what the file mode allows.

SELinux (RHEL/Fedora) and AppArmor (Ubuntu/Debian/SUSE) enforce policy on top of Unix
permissions: even if the mode says yes, the security context/profile can say no. The denial is
invisible in `ls -l` and shows up only in the audit log.

## Your Task

- Reproduce a "permission denied" that Unix permissions cannot explain.
- Determine whether SELinux/AppArmor is the cause and read the denial from the audit log.
- Fix it the correct way — adjusting context/policy, not disabling security.

## Starter Files

### file: notes.md

```text
Symptoms (SELinux example, e.g. nginx serving files from a non-standard path):
  $ ls -lZ /srv/web/index.html
    -rw-r--r--. root root unconfined_u:object_r:default_t:s0 index.html
                                              ^^^^^^^^^^ wrong type for web content
  $ curl localhost/ -> 403; nginx error log: "Permission denied"
  $ getenforce -> Enforcing

Unix perms (644, correct owner) look fine. SELinux denies nginx reading 'default_t'
content because web content must be labelled 'httpd_sys_content_t'.
```

## Expected Failure

```bash
# permissions look perfect:
ls -l /srv/web/index.html
# -rw-r--r-- 1 root root 12 ... index.html      <- readable, correct owner

# but access is denied and enforcement is on:
getenforce
# Enforcing
sudo tail -n3 /var/log/audit/audit.log | grep AVC
# type=AVC msg=audit(...): avc:  denied  { read } for  pid=... comm="nginx"
#   name="index.html" ... scontext=system_u:system_r:httpd_t:s0
#   tcontext=unconfined_u:object_r:default_t:s0 tclass=file permissive=0
```

The file mode is fine, but SELinux denied `nginx` (`httpd_t`) reading a file labelled
`default_t` — web content must carry `httpd_sys_content_t`. The `avc: denied` line in
`audit.log` is the definitive evidence; `ls -l` alone would never explain it. (AppArmor shows
an analogous `apparmor="DENIED"` line in `dmesg`/`journal`.)

## Expected Outcome

Access succeeds with the security layer still enforcing.

The file carries the correct SELinux context:

```bash
ls -Z /srv/web/index.html
# ... httpd_sys_content_t ... index.html

curl -s -o /dev/null -w '%{http_code}\n' localhost/
# 200
```

No new denials appear for the operation:

```bash
sudo ausearch -m AVC -ts recent | grep index.html || echo "no denials"
# no denials
```

Enforcement remains on (security not disabled to "fix" it):

```bash
getenforce
# Enforcing
```

## Hints

### Hint 1 — Suspect MAC when perms cannot explain it

If `ls -l`/ownership are correct yet access is denied, check the mandatory layer.
SELinux: `getenforce` (Enforcing/Permissive/Disabled), denials in `/var/log/audit/audit.log`
(`ausearch -m AVC -ts recent`, or `sealert` for readable explanations), contexts via `ls -Z`.
AppArmor: `aa-status`, denials as `apparmor="DENIED"` in `dmesg`/`journalctl`, profiles in
`/etc/apparmor.d/`.

### Hint 2 — Fix the label/profile, do not turn security off

SELinux: relabel the file to the right type (`chcon` for a temporary test; `semanage fcontext`
+ `restorecon` for a persistent, correct fix), or set the appropriate boolean
(`setsebool -P httpd_can_network_connect on`, etc.). AppArmor: adjust the profile
(`aa-logprof` walks you through observed denials) or set a profile to complain mode while
testing. Setting SELinux permissive or disabling AppArmor "fixes" it by removing protection —
avoid that outside a brief diagnostic step.

## Solution

Confirm it is the MAC layer from the audit log, then correct the context/policy while keeping
enforcement on. (SELinux example.)

```bash
# 1) confirm MAC is the cause
getenforce                                  # Enforcing
sudo ausearch -m AVC -ts recent             # shows the denied read + contexts
ls -Z /srv/web/index.html                   # wrong type: default_t

# 2) persistent, correct relabel for web content in a custom path
sudo semanage fcontext -a -t httpd_sys_content_t "/srv/web(/.*)?"
sudo restorecon -Rv /srv/web
ls -Z /srv/web/index.html                   # now httpd_sys_content_t

# 3) if the app needs a capability governed by a boolean, enable it persistently
#    sudo setsebool -P httpd_can_network_connect on

# 4) verify
curl -s -o /dev/null -w '%{http_code}\n' localhost/    # 200
sudo ausearch -m AVC -ts recent | grep index.html || echo "no denials"

# AppArmor equivalent:
#   sudo aa-status ; check journal for apparmor="DENIED"
#   sudo aa-logprof   # update the profile from observed denials
```

- **Mandatory access control overrides permissive file modes.** SELinux/AppArmor can deny what
  owner/group/mode allow, and the denial never appears in `ls -l`. Suspect them whenever
  permissions look correct but access fails.
- **The audit log is the evidence.** SELinux `avc: denied` in `/var/log/audit/audit.log`
  (`ausearch`/`sealert`); AppArmor `apparmor="DENIED"` in `dmesg`/journal. These lines name the
  subject context, object context, and the exact operation refused.
- **Fix the label or policy, not the enforcement.** SELinux: relabel with `semanage fcontext` +
  `restorecon` (persistent) or toggle the right boolean; AppArmor: refine the profile with
  `aa-logprof`. `chcon` is fine for a quick test but `restorecon` will revert it.
- **Never "solve" it by disabling security.** `setenforce 0` or removing an AppArmor profile
  makes the symptom vanish and leaves the host unprotected — the exact opposite of the intent.
  Permissive mode is for diagnosis only.
- **Custom paths are the usual trigger.** Serving content, storing databases, or opening
  sockets outside the default locations means the default labels/profiles do not fit — adjust
  policy to match your layout.
