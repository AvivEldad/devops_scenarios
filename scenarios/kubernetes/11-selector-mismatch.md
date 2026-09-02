# The label change that orphaned the pods

## Briefing

A Deployment is `2/2` ready, but a new `kubectl apply` fails with an error about an
immutable selector, or — in a variant — the Deployment shows `0` pods while two pods with
the app run happily, managed by nobody.

The selector and the pod template labels no longer agree. Selectors are immutable, and a
mismatch between selector and template labels breaks the ownership link.

## Your Task

- Apply the deployment and observe either the immutable-selector error or the orphaned
  pods.
- Explain the relationship between `spec.selector` and `spec.template.metadata.labels`.
- Fix it so the Deployment owns its pods, without leaving orphans running.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
      version: v1          # selector includes version
  template:
    metadata:
      labels:
        app: api
        version: v2        # template labels say v2 - mismatch
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
```

## Expected Failure

```bash
kubectl apply -f app.yaml
# The Deployment "api" is invalid: spec.template.metadata.labels:
# Invalid value: map[string]string{"app":"api", "version":"v2"}:
# `selector` does not match template `labels`
```

A Deployment's selector must match its pod template labels — the selector is how the
Deployment finds the pods it owns. Here the selector wants `version: v1` and the template
produces `version: v2`, so the Deployment could never recognise its own pods.

If the selector had been changed on an existing Deployment instead, you would get
`field is immutable`, because selectors cannot be edited after creation.

## Expected Outcome

The Deployment owns its pods and rolls out.

Selector and template labels agree:

```bash
kubectl get deploy api -o jsonpath='{.spec.selector.matchLabels}{"\n"}'
kubectl get deploy api -o jsonpath='{.spec.template.metadata.labels}{"\n"}'
# both contain the same app/version labels
```

Pods are owned and ready:

```bash
kubectl get deploy api
# api   2/2   2   2   1m

kubectl get rs -l app=api
# a ReplicaSet with DESIRED=2 CURRENT=2 READY=2
```

No orphaned pods (pods with no controlling owner) remain:

```bash
kubectl get pods -l app=api -o jsonpath='{range .items[*]}{.metadata.ownerReferences[0].kind}{"\n"}{end}'
# ReplicaSet (for every pod)
```

## Hints

### Hint 1 — Selector must match template labels

`spec.selector.matchLabels` must be a subset of `spec.template.metadata.labels`. The
selector is the query the Deployment/ReplicaSet uses to find its pods; if the template
produces different labels, the query matches nothing and the API rejects it.

### Hint 2 — Selectors are immutable; recreate to change them

You cannot edit `spec.selector` on an existing Deployment (`field is immutable`). To change
selector labels you must delete and recreate the Deployment. Use `--cascade=orphan` if you
want to keep the pods running during the swap, then let the new Deployment adopt them — but
usually a clean recreate is simpler.

## Solution

Selector and template labels disagreed. Make them consistent.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
        version: v2
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
```

```bash
kubectl apply -f app.yaml
kubectl rollout status deploy/api
```

- **The selector must match the pod template labels.** It is how the controller finds the
  pods it owns; a mismatch is rejected at apply time (new object) or is impossible to fix by
  editing (existing object, immutable field).
- **Keep the selector minimal and stable.** Put only identity labels (`app: api`) in the
  selector, and put changeable labels (`version`) only in the template. Baking a changing
  label into the selector is what creates the immutability trap.
- **Selectors are immutable after creation.** Changing them means delete-and-recreate;
  `--cascade=orphan` preserves pods during the transition if you need zero downtime.
- **Orphaned pods have no `ownerReferences`.** They keep running but are managed by nothing —
  no rollout, no scaling, no self-healing. Adopt or delete them deliberately.
