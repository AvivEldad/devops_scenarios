# The instance profile is attached and the app still uses yesterday's keys

## Briefing

The app instance has `app-prod-role` attached. `aws sts get-caller-identity`
from an interactive shell on the box returns that role. The application itself
fails every night after a contractor's IAM user was deactivated:

```
An error occurred (InvalidClientTokenId) when calling the GetObject operation:
The security token included in the request is invalid.
```

Sometimes it is `AccessDenied` as a still-live user that is not the instance
role. IMDS is healthy. The process is not using it.

## Your Task

- From the process environment and IMDS, say which credentials the app SDK
  actually sends.
- Explain why a shell on the same instance can succeed while the service fails.
- Remove the static keys so the instance profile is what signs requests.

## Starter Files

### file: /etc/app.env

```
# leftover from the 2023 "just get it working" weekend
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=eu-west-1
BUCKET=prod-reports-111122223333
```

### file: systemd-snippet.txt

```
[Service]
EnvironmentFile=/etc/app.env
User=app
# no AWS_PROFILE, no aws-vault
ExecStart=/usr/bin/app
```

### file: host-checks.txt

```
$ curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/
app-prod-role

$ sudo -u app bash -c 'aws sts get-caller-identity'
InvalidClientTokenId   # inherits EnvironmentFile via a wrapper
                       # OR, from a login shell without the env file:
arn:aws:sts::111122223333:assumed-role/app-prod-role/i-0abc

$ tr '\0' '\n' < /proc/$(pgrep -n app)/environ | grep AWS_
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=...
```

## Expected Failure

The SDK credential chain is, in order: environment variables, shared config
file, then IMDS. Environment wins. The instance profile never gets a chance.

CloudTrail `userIdentity` for the failing `GetObject` is
`arn:aws:iam::111122223333:user/contractor-tmp`, not `app-prod-role`.

Deactivating that user turns a quiet wrong-principal problem into
`InvalidClientTokenId`. The instance profile was fine the whole time.

## Expected Outcome

The app process has no `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
`get-caller-identity` from that process is `app-prod-role`. GetObject works.
CloudTrail shows the role, not an IAM user.

## Hints

### Hint 1 — The chain is ordered, IMDS is last

Boto, the AWS CLI, and most SDKs treat env vars as authoritative. An attached
instance profile is irrelevant until those vars are gone. `curl` to IMDS
proves the *host* can get role creds. It does not prove the *process* uses
them.

### Hint 2 — Read the process environ, not your shell

Your SSH session does not load `EnvironmentFile=`. The service does. Dump
`/proc/<pid>/environ` or turn on SDK debug logging (`aws_access_key_id` source).
CloudTrail `userIdentity.type` of `IAMUser` on an EC2 app is the smoking gun.

## Solution

Delete the static keys from the service environment. Leave the instance
profile as the only credential source. Rotate/disable `AKIAIOSFODNN7EXAMPLE`
if it is still active.

```bash
# /etc/app.env — region and bucket only
AWS_DEFAULT_REGION=eu-west-1
BUCKET=prod-reports-111122223333
# no access key variables

sudo systemctl daemon-reload && sudo systemctl restart app
sudo -u app --preserve-env=false aws sts get-caller-identity
# arn:aws:sts::111122223333:assumed-role/app-prod-role/...
```

- **Never ship long-lived keys onto EC2** when a role is already attached.
- **Wrong instance profile** is a different incident: IMDS would name the
  other role. Here IMDS was right and the env was louder.
- **Rotate the leaked user keys.** Removing them from the unit file is not
  enough if they still exist in IAM.
