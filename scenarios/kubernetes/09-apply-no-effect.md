# The deployment applied cleanly and nothing changed

## Briefing

You edit a Deployment's image tag, `kubectl apply`, and get
`deployment.apps/api configured` — or sometimes `unchanged`. The pods keep running the old
image. No error, no rollout.

Either the apply did not change what you thought, or the change did not trigger a rollout,
or you edited a copy that is not what the cluster has. This drill is about confirming that
an apply actually did something.

## Your Task

- Apply a change and observe that the running pods do not update.
- Determine whether the change reached the cluster and whether it triggered a rollout.
- Make the intended change take effect and verify the new pods run it.

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
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: nginx:1.27-alpine
```

### file: notes.md

```text
You THINK you changed the image to nginx:1.27.2-alpine, but:
  - you edited a local copy, or
  - you changed a field that does not alter the pod template, or
  - apply said "unchanged" and you did not notice
```

## Expected Failure

```bash
kubectl apply -f app.yaml
# deployment.apps/api unchanged

kubectl get pods -l app=api -o jsonpath='{.items[*].spec.containers[0].image}{"\n"}'
# nginx:1.27-alpine nginx:1.27-alpine      <- still the old image
```

`unchanged` means the manifest matched what the cluster already had — your intended edit
never made it into the file you applied, or you applied the wrong file.

## Expected Outcome

The change is applied and rolls out.

The apply reports a real change:

```bash
kubectl apply -f app.yaml
# deployment.apps/api configured
```

A rollout happens and completes:

```bash
kubectl rollout status deploy/api
# deployment "api" successfully rolled out
```

The new pods run the new image:

```bash
kubectl get pods -l app=api -o jsonpath='{.items[*].spec.containers[0].image}{"\n"}'
# nginx:1.27.2-alpine nginx:1.27.2-alpine
```

The rollout history records the change:

```bash
kubectl rollout history deploy/api
# a new revision
```

## Hints

### Hint 1 — Confirm what the cluster actually has

```bash
kubectl get deploy api -o yaml | grep image:
kubectl diff -f app.yaml
```

`kubectl diff` shows exactly what an apply *would* change. If it shows nothing, your file
equals the cluster state — the edit is not where you think, or you are applying the wrong
path.

### Hint 2 — Only pod-template changes trigger a rollout

Changing `spec.replicas` scales but does not roll. Only changes under
`spec.template` (the pod spec) create a new ReplicaSet and roll pods. If you need to force
pods to restart without a spec change, `kubectl rollout restart deploy/api`.

## Solution

The applied file did not contain the intended change (`unchanged` was the clue). Make the
change, confirm with `diff`, apply, and watch the rollout.

```bash
# make the real edit
sed -i 's/nginx:1.27-alpine/nginx:1.27.2-alpine/' app.yaml

# confirm the change will land BEFORE applying
kubectl diff -f app.yaml

kubectl apply -f app.yaml         # -> configured
kubectl rollout status deploy/api
kubectl get pods -l app=api -o jsonpath='{.items[*].spec.containers[0].image}{"\n"}'
```

- **`unchanged` vs `configured` is the first signal.** `unchanged` means the manifest equals
  cluster state — your edit is missing or you applied the wrong file. Never skim past it.
- **`kubectl diff -f` before `apply`** shows precisely what will change, turning "did this do
  anything?" into a certainty and catching wrong-file mistakes.
- **Only `spec.template` changes roll pods.** Editing replicas scales; editing labels or the
  container spec rolls. `kubectl rollout restart` forces new pods when you need a restart
  without a spec change (e.g. to pick up a changed ConfigMap).
- **Watch `rollout status`** rather than assuming — it confirms the new ReplicaSet came up
  healthy, and fails fast if the new pods cannot start.
- **Beware editing live objects** (`kubectl edit`) when you also manage YAML in git: the
  next `apply` may revert your live edit, or your file may be stale. Keep one source of
  truth.
