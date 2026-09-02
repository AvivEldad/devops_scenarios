# The pod that cannot read its own secret

## Briefing

A pod needs a database password from a Secret and starts without it, falling back to an
empty password and failing to connect. The Secret exists in the namespace.

The reference is subtly wrong — a mismatched key name — and there is a second common
mistake: the Secret is in a different namespace than the pod, where it cannot be seen.

## Your Task

- Apply the Secret and Deployment and confirm the password is empty in the container.
- Find the mismatch between what the pod asks for and what the Secret provides.
- Fix it so the value is injected.

## Starter Files

### file: secret.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: default
type: Opaque
stringData:
  db-password: "s3cr3t-pw"
```

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels: { app: worker }
  template:
    metadata:
      labels: { app: worker }
    spec:
      containers:
        - name: worker
          image: busybox:1.36
          command: ["sh", "-c", "echo pw=[$DB_PASSWORD]; sleep 3600"]
          env:
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: password          # the Secret's key is 'db-password'
```

## Expected Failure

```bash
kubectl apply -f secret.yaml -f app.yaml
kubectl get pods
# worker-xxxx   0/1   CreateContainerConfigError   0   20s
```

```bash
kubectl describe pod -l app=worker | tail -4
# Error: couldn't find key password in Secret default/db-credentials
```

The pod asked for key `password`; the Secret provides `db-password`. Kubernetes refuses to
start the container because the referenced key does not exist.

## Expected Outcome

The secret value reaches the container.

```bash
kubectl get pods
# worker-xxxx   1/1   Running   0   20s

kubectl logs deploy/worker
# pw=[s3cr3t-pw]
```

The key referenced matches the key stored:

```bash
kubectl get secret db-credentials -o jsonpath='{.data}' | tr ',' '\n'
# "db-password":"..."
```

The pod and secret are in the same namespace.

## Hints

### Hint 1 — The key name must match

`secretKeyRef.key` must equal a key in the Secret's `data`. The Secret has `db-password`;
the pod asked for `password`. A missing key gives `CreateContainerConfigError`, not an
empty value — Kubernetes will not start the container at all.

### Hint 2 — Secrets are namespaced

A pod can only reference Secrets (and ConfigMaps) in its own namespace. If the Secret is in
`default` and the pod in `apps`, the reference fails. Put them in the same namespace, or
replicate the Secret.

## Solution

The referenced key did not exist in the Secret.

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: db-password          # matches the Secret
```

```bash
kubectl apply -f app.yaml
kubectl rollout status deploy/worker
kubectl logs deploy/worker
```

- **`secretKeyRef.key` must match a key in the Secret.** A mismatch is
  `CreateContainerConfigError` — the container never starts, which is safer than silently
  using an empty password but confusing if you expect the latter.
- **Secrets and ConfigMaps are namespaced.** A pod references only those in its own
  namespace; cross-namespace access requires copying the object or a tool that syncs it.
- **Secret `data` is base64; `stringData` is plaintext on write.** `kubectl get secret -o
  yaml` shows base64 — decode with `base64 -d` to verify contents.
- **Prefer projecting only the keys you need**, and consider mounting secrets as files
  rather than env vars for values that should not appear in `kubectl describe` or crash
  dumps of the environment.
