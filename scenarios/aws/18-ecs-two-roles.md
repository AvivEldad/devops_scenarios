# The task role can read S3. The image never starts.

## Briefing

ECS was given "the S3 role" so the app could `GetObject`. The service is
stuck on `CannotPullContainerError`. ECR is in the same account. The
execution role is the AWS managed `ecsTaskExecutionRole` with only the
default CloudWatch Logs policy — or, after a panicked edit, the S3 policy
was attached to the execution role and the task role is empty.

Two roles, two jobs: **execution** = agent (pull image, write logs, fetch
secrets); **task** = application AWS SDK. Mixing them produces exactly this
ticket: IAM "looks attached" on the task definition and the container never
runs, or it runs and S3 is still denied.

## Your Task

- Map the error (pull vs runtime GetObject) to execution vs task role.
- Read the task definition `executionRoleArn` and `taskRoleArn`.
- Put ECR/logs on the execution role and S3 on the task role. Do not use
  one role for both unless you can state why.

## Starter Files

### file: taskdef.json

```json
{
  "family": "api-prod",
  "executionRoleArn": "arn:aws:iam::111122223333:role/app-s3-reader",
  "taskRoleArn": "arn:aws:iam::111122223333:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "111122223333.dkr.ecr.eu-west-1.amazonaws.com/api:1.4.2",
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/api-prod",
          "awslogs-region": "eu-west-1"
        }
      }
    }
  ]
}
```

### file: role-policies.txt

```
role/app-s3-reader
  s3:GetObject  arn:aws:s3:::prod-reports/*
  s3:ListBucket arn:aws:s3:::prod-reports

role/ecsTaskExecutionRole
  AmazonECSTaskExecutionRolePolicy
    ecr:GetAuthorizationToken *
    ecr:BatchGetImage, GetDownloadUrlForLayer  on *
    logs:CreateLogStream, PutLogEvents
```

### file: stopped-reason.txt

```
CannotPullContainerError: pull image manifest has been retried 5 time(s):
httpReaderSeeker: failed open: unexpected status code
https://111122223333.dkr.ecr.eu-west-1.amazonaws.com/v2/api/manifests/1.4.2:
403 Forbidden
```

## Expected Failure

Tasks stop on pull. CloudTrail: `GetAuthorizationToken` or `BatchGetImage`
AccessDenied as `app-s3-reader`. The execution role is the S3 role. The
role that *can* talk to ECR is listed as `taskRoleArn`, which is not used
until after the image exists.

If someone swaps nothing and only adds S3 to execution, pull starts working
and the app then gets S3 AccessDenied — the inverse of this paste.

## Expected Outcome

```
executionRoleArn: role/ecsTaskExecutionRole
taskRoleArn:      role/app-s3-reader
```

Task reaches RUNNING. App GetObject succeeds. Pull and `awslogs` still
work. Execution role does not have `s3:*`.

## Hints

### Hint 1 — CannotPullContainerError is never the task role

The agent uses `executionRoleArn` before your process starts. 403 from ECR
during pull is that role. S3 errors in *application* logs are `taskRoleArn`.

### Hint 2 — They are swapped in the task definition

Read the two ARNs. Here they are backwards. Console "Task role" vs "Task
execution role" labels are easy to invert when pasting.

## Solution

Unswap the ARNs. Keep policies where they are.

```json
"executionRoleArn": "arn:aws:iam::111122223333:role/ecsTaskExecutionRole",
"taskRoleArn": "arn:aws:iam::111122223333:role/app-s3-reader"
```

Register a new revision and deploy. If you pull from a private registry
with secrets, `secrets` / `repositoryCredentials` also use the execution
role — still not the task role.

- **One role for both** works technically and wrecks least privilege
  (the app can then `ecr:GetAuthorizationToken`).
- **IRSA/task role confusion on EKS** is a later lab; this is ECS.
- **Logs 403** after a successful pull is still execution role
  (`logs:PutLogEvents`), not S3.
