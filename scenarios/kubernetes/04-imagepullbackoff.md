# ImagePullBackOff on an image that exists

## Briefing

A pod is stuck in `ImagePullBackOff`. The image is real — you can `docker pull` it on
your laptop. In the cluster it will not come down.

The tag is wrong, or the registry needs credentials the pod does not have. Both produce
this status, and the events tell you which.

## Your Task

- Apply the deployment and confirm the pod cannot pull its image.
- Read the events to find the exact pull error.
- Fix the reference so the image pulls.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpin      # typo in the tag
          ports:
            - containerPort: 80
```

## Expected Failure

```bash
kubectl apply -f app.yaml
kubectl get pods
# NAME                   READY   STATUS             RESTARTS   AGE
# web-xxxx               0/1     ImagePullBackOff   0          40s
```

```bash
kubectl describe pod -l app=web | tail -6
# Failed to pull image "nginx:1.27-alpin": ... manifest unknown
# Error: ErrImagePull
# Back-off pulling image "nginx:1.27-alpin"
```

`manifest unknown` means the registry has no such tag. `nginx:1.27-alpin` is a typo for
`1.27-alpine`.

## Expected Outcome

The pod pulls and runs.

```bash
kubectl get pods
# web-xxxx   1/1   Running   0   30s
```

The image reference is a real, existing tag:

```bash
kubectl get deploy web -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
# nginx:1.27-alpine
```

Events show a successful pull, not a backoff:

```bash
kubectl describe pod -l app=web | grep -i pulled
# Successfully pulled image "nginx:1.27-alpine"
```

## Hints

### Hint 1 — The events name the exact cause

```bash
kubectl describe pod <name>
```

- `manifest unknown` / `not found` → wrong image name or tag
- `pull access denied` / `unauthorized` → private registry needing an imagePullSecret
- `no such host` / timeout → the node cannot reach the registry

Read the message before assuming; the three causes have different fixes.

### Hint 2 — Fix the reference or add a pull secret

For a typo, correct the tag. For a private image, create and reference a pull secret:

```bash
kubectl create secret docker-registry regcred \
  --docker-server=REGISTRY --docker-username=USER --docker-password=PASS
```

```yaml
spec:
  imagePullSecrets:
    - name: regcred
```

## Solution

The tag was misspelled.

```yaml
spec:
  template:
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
```

```bash
kubectl apply -f app.yaml
kubectl rollout status deploy/web
```

- **`ImagePullBackOff` is a pull failure, and `kubectl describe` names it.** Typo, missing
  credentials, or unreachable registry — each shows a distinct message and needs a distinct
  fix. Read it first.
- **`ErrImagePull` is the first attempt; `ImagePullBackOff` is Kubernetes backing off** after
  repeated failures, with increasing delay. Same underlying cause.
- **Private registries need an `imagePullSecret`**, referenced on the pod or attached to its
  ServiceAccount. `unauthorized`/`pull access denied` is the tell.
- **Avoid `:latest`.** A mutable tag makes "which image is running" unanswerable and defeats
  rollback — the same drift problem as the Docker tag scenario. Pin a real version.
