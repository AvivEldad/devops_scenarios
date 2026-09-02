# IMDS works on the host and 401s in the container

## Briefing

The EC2 instance profile is correct. On the host, `curl` to IMDS returns
role credentials. The same curl inside the app container returns `401
Unauthorized`, or the PUT for a session token never comes back.

IMDSv2 is required. Hop limit is `1`. The container is one hop past the
host network namespace, so the token response is dropped. The host never
needed a second hop. This looks like "the instance profile is broken" if
you only test from SSH.

## Your Task

- Explain why the host succeeds and the container gets 401 / no token.
- Read `HttpPutResponseHopLimit` and `HttpTokens` from the instance
  metadata options.
- Fix it so the container can obtain an IMDSv2 token, without disabling
  IMDSv2 and without putting static keys in the image.

## Starter Files

### file: metadata-options.json

```json
{
  "InstanceId": "i-0abc",
  "HttpTokens": "required",
  "HttpPutResponseHopLimit": 1,
  "HttpEndpoint": "enabled",
  "IamInstanceProfile": {
    "Arn": "arn:aws:iam::111122223333:instance-profile/app-prod-role"
  }
}
```

### file: repro.sh

```bash
#!/usr/bin/env bash
# host (works):
TOKEN=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
curl -sS -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
# app-prod-role

# inside the container (docker run --network bridge, default):
# PUT /latest/api/token   → empty / timeout (TTL expired at the host)
# GET without token       → 401 Unauthorized  (HttpTokens=required)
```

### file: container-log.txt

```
botocore.exceptions.ClientError: Unable to locate credentials
# or: Received 401 from IMDS
# docker inspect: NetworkMode=bridge, extra hop to 169.254.169.254
```

## Expected Failure

Host: IMDSv2 token + role name. Container: `401` on GET, or no token from
PUT. The SDK never assumes `app-prod-role`. App errors look like missing
IAM, but `describe-instances` shows the profile.

## Expected Outcome

Container can PUT `/latest/api/token` and GET security-credentials.
`HttpTokens` stays `required`. Hop limit is `2` (containers on the instance)
or the task uses a task role / IRSA instead of IMDS. No access keys in env.

## Hints

### Hint 1 — IMDSv2 is a PUT then a GET

`HttpTokens=required` turns a bare GET into 401. That 401 is not "wrong
role", it is "no token". If the PUT never returns, you never get a token.
Hop limit `1` is enough for processes on the host network and too small
once traffic crosses into a bridge/CNI namespace.

### Hint 2 — 401 vs timeout vs 404

401 + required tokens: you skipped the PUT. Empty PUT + hop limit 1:
packet died. 404 on the role name: no instance profile. Those three are
different fixes.

## Solution

Raise the hop limit for container hosts, keep IMDSv2 on:

```
aws ec2 modify-instance-metadata-options --instance-id i-0abc \
  --http-tokens required --http-put-response-hop-limit 2
```

Prefer not using IMDS from containers at all: ECS task role, EKS IRSA, or
host network only for a sidecar that already has to be trusted.

- **Do not set `HttpTokens=optional`** to "make 401 go away". That reopens
  SSRF-to-IMDS.
- **Do not bake keys** because hop limit was 1.
- **Hop limit 2** is the usual EC2+Docker fix; Kubernetes often needs the
  same or, better, IRSA so pods never talk to IMDS.
