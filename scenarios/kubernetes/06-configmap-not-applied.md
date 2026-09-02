# The environment variable that is not in the container

## Briefing

An app reads configuration from a ConfigMap. It starts with defaults instead, because the
values it expects are not in its environment. The ConfigMap exists and has the right keys.

The Deployment references the ConfigMap in a way that does not actually inject the values,
and one key name does not match what the app reads.

## Your Task

- Apply both objects and confirm the app runs with defaults.
- Determine what environment the container actually has.
- Wire the ConfigMap in so the values reach the process.

## Starter Files

### file: config.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  APP_MODE: "production"
  LOG_LEVEL: "info"
```

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: busybox:1.36
          command: ["sh", "-c", "echo mode=$APP_MODE level=$LOG_LEVEL; sleep 3600"]
          # the ConfigMap is created but never referenced here
```

## Expected Failure

```bash
kubectl apply -f config.yaml -f app.yaml
kubectl logs deploy/api
# mode= level=
```

Both variables are empty. The ConfigMap exists but nothing in the pod spec pulls it into
the container's environment.

```bash
kubectl exec deploy/api -- env | grep -E 'APP_MODE|LOG_LEVEL'
# (no output)
```

## Expected Outcome

The container sees the ConfigMap values.

```bash
kubectl logs deploy/api
# mode=production level=info
```

The environment contains the keys:

```bash
kubectl exec deploy/api -- env | grep -E 'APP_MODE|LOG_LEVEL'
# APP_MODE=production
# LOG_LEVEL=info
```

Changing the ConfigMap and restarting the deployment propagates new values:

```bash
kubectl set data ... # or edit; then rollout restart
kubectl logs deploy/api
# reflects the new value
```

## Hints

### Hint 1 — Reference the ConfigMap in the pod spec

A ConfigMap does nothing until a pod consumes it. Inject all keys as environment variables
with `envFrom`:

```yaml
containers:
  - name: api
    envFrom:
      - configMapRef:
          name: app-config
```

or pull specific keys with `env` + `valueFrom.configMapKeyRef`.

### Hint 2 — Key names must match what the app reads

If the app reads `LOG_LEVEL`, the ConfigMap key must be `LOG_LEVEL` (with `envFrom`) or the
`env` name must be set to it. A mismatch leaves the variable unset with no error.

## Solution

The ConfigMap was never referenced by the pod.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: busybox:1.36
          command: ["sh", "-c", "echo mode=$APP_MODE level=$LOG_LEVEL; sleep 3600"]
          envFrom:
            - configMapRef:
                name: app-config
```

```bash
kubectl apply -f app.yaml
kubectl rollout restart deploy/api
kubectl logs deploy/api
```

- **A ConfigMap is inert until a pod references it.** `envFrom` injects all keys; `env` with
  `configMapKeyRef` injects chosen ones. Creating the ConfigMap alone changes nothing.
- **Key names must match exactly** — a missing key yields an empty variable, not an error,
  which is why the app silently used defaults.
- **ConfigMap changes do not restart pods.** Env values are captured at pod start; you must
  `kubectl rollout restart` (or mount as a volume, which updates in place with a delay) to
  pick up changes. A checksum annotation on the pod template is the common trick to force a
  restart on change.
- **Secrets work the same way** with `secretRef`/`secretKeyRef` — same referencing rules,
  same restart behaviour.
