# AccessDenied in us-east-1 for a secret that exists

## Briefing

Prod database password lives in Secrets Manager. The rotation Lambda writes it
in `eu-west-1`. The deploy job, copied from a US tutorial, exports
`AWS_DEFAULT_REGION=us-east-1`.

```
An error occurred (ResourceNotFoundException) when calling the GetSecretValue
operation: Secrets Manager can't find the specified secret.
```

On a bad day the S3 call in the same job returns `AccessDenied` instead. The
on-call opened an IAM ticket. The identity policy is not the problem. The
client is asking a different region's API for a resource that was never there.

## Your Task

- From the env, the secret ARN, and the CLI errors, name the region the client
  is calling versus the region the resource is in.
- Explain why one API says `ResourceNotFound` and another can look like IAM.
- Fix the environment (or the ARN/endpoint) so the job reads the secret and the
  bucket without changing IAM.

## Starter Files

### file: .env

```
AWS_DEFAULT_REGION=us-east-1
AWS_REGION=us-east-1
SECRET_NAME=prod/db
# copied from the runbook; the ARN is the source of truth
# arn:aws:secretsmanager:eu-west-1:111122223333:secret:prod/db-AbCdEf
BUCKET=prod-reports-111122223333
```

### file: deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
# region comes only from the environment — no --region on the CLI
aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}"
aws s3 cp "s3://${BUCKET}/manifest.json" -
```

### file: cli-errors.txt

```
$ aws secretsmanager get-secret-value --secret-id prod/db
ResourceNotFoundException: Secrets Manager can't find the specified secret.

$ aws s3api get-object --bucket prod-reports-111122223333 --key manifest.json /tmp/m
# depending on endpoint:
# IllegalLocationConstraintException  OR  PermanentRedirect  OR  AccessDenied

$ aws secretsmanager list-secrets --region us-east-1
# (empty)   prod/db is not in this region

$ aws secretsmanager list-secrets --region eu-west-1
# ARN: arn:aws:secretsmanager:eu-west-1:111122223333:secret:prod/db-AbCdEf
```

## Expected Failure

Same credentials, two regions, two different lies:

- Secrets Manager: `ResourceNotFoundException` — the name `prod/db` is looked
  up in `us-east-1`. Nothing by that name exists there. That is not IAM.
- S3: a 301/redirect or `AccessDenied` with no mention of region. People "fix"
  this by attaching `AmazonS3FullAccess`. The bucket is still in `eu-west-1`.

`sts get-caller-identity` succeeds. Identity is fine.

## Expected Outcome

```
export AWS_REGION=eu-west-1
# or: --region eu-west-1 on every call
# or: pass the full secret ARN (it contains the region)

aws secretsmanager get-secret-value --secret-id prod/db --region eu-west-1
# SecretString: {"user":"app","password":"..."}

aws s3 cp s3://prod-reports-111122223333/manifest.json - --region eu-west-1
# { "build": 42 }
```

IAM is unchanged. The job no longer defaults to `us-east-1`.

## Hints

### Hint 1 — The ARN already told you the region

`arn:aws:secretsmanager:eu-west-1:111122223333:secret:prod/db-AbCdEf` is not a
hint, it is the location. `AWS_DEFAULT_REGION` and `AWS_REGION` choose the
endpoint. A name without `--region` is resolved in that endpoint's partition
slice, not "in the account".

### Hint 2 — Not-found is not AccessDenied, except when S3 pretends

Secrets Manager is honest: wrong region → `ResourceNotFoundException`. S3 is
not always honest. Some regional endpoints return `AccessDenied` or a redirect
you only see with `--debug`. If `list-secrets` in another region finds it, stop
editing policies.

## Solution

Point the client at `eu-west-1`. Prefer the full ARN for the secret so a wrong
default region fails loudly instead of silently looking in Virginia.

```bash
unset AWS_DEFAULT_REGION
export AWS_REGION=eu-west-1
aws secretsmanager get-secret-value \
  --secret-id arn:aws:secretsmanager:eu-west-1:111122223333:secret:prod/db-AbCdEf
```

- **Regional services do not share a namespace.** `prod/db` in `us-east-1` is a
  different resource from `prod/db` in `eu-west-1`.
- **IAM errors are a last hypothesis** when `get-caller-identity` works and
  `list-*` in the home region shows the object.
- **CI images** that bake `AWS_DEFAULT_REGION=us-east-1` will reproduce this on
  every EU account until you kill the default.
