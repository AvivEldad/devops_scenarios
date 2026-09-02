# The pod's service account is not the one the role trusts

## Briefing

An EKS pod using the `api` ServiceAccount cannot GetObject. A debug pod
on the same node using the instance profile (or a different SA) can,
until you tightened the node role. `sts get-caller-identity` inside the
broken pod is either the **node role** (annotation never projected) or
an error from the web-identity credential provider.

IRSA needs three strings to agree: the SA annotation's role ARN, the
role trust's OIDC issuer, and `sub` =
`system:serviceaccount:<namespace>:<name>`. A typo in the namespace
(`payment` vs `payments`) is enough. This is not the ECS two-role lab
and not "CI cannot AssumeRole" for an IAM user.

## Your Task

- Compare SA annotation, pod namespace/name, and the trust `sub`.
- Say whether the pod is failing to assume, or assuming the wrong
  identity (node).
- Fix annotation and/or trust `sub` so the pod session is
  `role/app-s3` and GetObject works.

## Starter Files

### file: serviceaccount.yaml

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
  namespace: payment
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::111122223333:role/app-s3
```

### file: trust-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::111122223333:oidc-provider/oidc.eks.eu-west-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.eu-west-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:aud": "sts.amazonaws.com",
          "oidc.eks.eu-west-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub": "system:serviceaccount:payments:api"
        }
      }
    }
  ]
}
```

### file: pod-diag.txt

```
# projected token (if annotation is present):
kubectl exec -n payment deploy/api -- cat \
  /var/run/secrets/eks.amazonaws.com/serviceaccount/token
# JWT sub: system:serviceaccount:payment:api     ← singular

# SDK:
# AccessDenied on AssumeRoleWithWebIdentity  OR  GetObject as node instance role

# cluster OIDC:
aws eks describe-cluster --name prod --query identity.oidc.issuer
# https://oidc.eks.eu-west-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE
```

## Expected Failure

GetObject AccessDenied from the pod. Trust `sub` is
`system:serviceaccount:payments:api`. The token `sub` is
`system:serviceaccount:payment:api`. AssumeRoleWithWebIdentity does not
match. If the mutating webhook did not inject, there is no web identity
file and the node role is used (often also denied after a hardening
ticket).

## Expected Outcome

```
kubectl exec -n payment deploy/api -- aws sts get-caller-identity
# arn:aws:sts::111122223333:assumed-role/app-s3/botocore-session-...
```

GetObject succeeds. Trust `sub` matches this SA only — not
`system:serviceaccount:*:*`.

## Hints

### Hint 1 — Decode the projected JWT

The `sub` claim is ground truth for what STS will see. Trust policy
must equal that string. Namespace is part of the name.

### Hint 2 — Annotation vs trust vs OIDC provider

Wrong role ARN in the annotation: you assume a role that may not exist
or has no S3. Wrong OIDC provider id: token is signed by cluster A,
trust names cluster B. Wrong `sub`: this lab.

## Solution

Align `sub` with the real SA (or move the SA to `payments` if that was
the intended namespace):

```json
"oidc.eks.eu-west-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE:sub":
  "system:serviceaccount:payment:api"
```

Restart the pod so it picks up a new token after SA edits. Confirm the
IAM identity policy on `app-s3` still allows the bucket (IRSA does not
replace that).

- **Do not set `sub` to `*`.** That lets every SA in the cluster assume
  the role.
- **Node role fallback** is a security incident, not a convenience.
- **`aud` must stay `sts.amazonaws.com`.** Dropping `sub` and keeping
  only `aud` is a confused-deputy cousin.
