# The instance is healthy. The load balancer says it is not.

## Briefing

EC2 status checks are `2/2 passed`. The app process is up. `curl
localhost:8080/ready` on the box returns 200. The ALB serves 502. Target
group health is `unhealthy` for every instance.

The target group was created from a wizard: protocol HTTP, port 80, path
`/`. The app listens on 8080 and has no handler on `/`. Instance health and
target health are different systems. This is not a security-group blackhole
for users — the health check is the only client that is failing, and the
ALB will not send production traffic until it passes.

## Your Task

- Compare target-group health check (port, path, protocol) to what the
  process actually serves.
- Explain why EC2 `2/2` can be green the entire time.
- Point the health check at the real ready endpoint without opening a
  second listener "for the ALB".

## Starter Files

### file: target-group.json

```json
{
  "TargetGroupName": "api-prod",
  "Protocol": "HTTP",
  "Port": 8080,
  "HealthCheckEnabled": true,
  "HealthCheckProtocol": "HTTP",
  "HealthCheckPort": "80",
  "HealthCheckPath": "/",
  "HealthCheckIntervalSeconds": 15,
  "HealthyThresholdCount": 2,
  "Matcher": { "HttpCode": "200" }
}
```

### file: on-instance.txt

```
ss -lnt
# LISTEN 0 128 *:8080  (nothing on :80)

curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/ready
# 200
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
# 404
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:80/ready
# 000  connection refused
```

### file: describe-target-health.txt

```
i-api-1  unhealthy  Target.FailedHealthChecks
i-api-2  unhealthy  Target.FailedHealthChecks
# ELB security group → instance: tcp/8080 from sg-alb  (already allowed)
```

## Expected Failure

```
curl -sS -o /dev/null -w "%{http_code}\n" https://api.example.com/ready
# 502
```

ALB health checker connects to **port 80** (override), not the target
group's 8080, and requires `/` to be 200. Refused or 404 → unhealthy → 502
for everyone.

## Expected Outcome

```
aws elbv2 describe-target-health --target-group-arn ...
# i-api-1 healthy
# i-api-2 healthy

curl -sS https://api.example.com/ready
# ok
```

Health check protocol HTTP, port `traffic-port` or `8080`, path `/ready`,
success codes `200`. Instances still `2/2`.

## Hints

### Hint 1 — HealthCheckPort "80" is not "the app port"

When `HealthCheckPort` is an integer, it **overrides** the target port.
`traffic-port` follows the registered 8080. Wizards default to 80/`/`.

### Hint 2 — 404 is an unhealthy 200-matcher

A node can listen and still fail the check. `Matcher.HttpCode` is exact.
Use `/ready` or `/healthz`, not `/` if `/` is a 404 SPA fallback.

## Solution

Align the check with the process:

```
aws elbv2 modify-target-group --target-group-arn arn:aws:elasticloadbalancing:... \
  --health-check-protocol HTTP \
  --health-check-port traffic-port \
  --health-check-path /ready \
  --matcher HttpCode=200
```

If the check used HTTPS against an HTTP app, you would see TLS errors in
the reason code instead of refused/404 — same class of bug, different
field.

- **EC2 status checks** are hypervisor reachability, not your URL.
- **Do not add nginx on :80** just to satisfy a wrong check unless you
  meant to put a proxy there.
- **SG must allow the ALB SG on the health-check port.** Here 8080 was
  already open; the port in the check was wrong.
