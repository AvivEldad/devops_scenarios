# The namespace stuck in Terminating forever

## Briefing

You deleted a namespace an hour ago. It is still there, status `Terminating`. Nothing you
do removes it, and you cannot recreate resources with the same names.

A resource in the namespace has a finalizer that never completed — usually because the
controller responsible for it is gone. The namespace cannot finish deleting until the
finalizer is cleared.

## Your Task

- Reproduce a namespace that will not finish terminating.
- Identify what is blocking deletion.
- Clear the blocker safely and let the namespace delete.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace stuck-demo

# a resource carrying a finalizer whose controller does not exist,
# so the finalizer will never be removed automatically
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: blocker
  namespace: stuck-demo
  finalizers:
    - example.com/nonexistent-controller
data:
  note: "this finalizer will never be cleared by anyone"
EOF

echo "now: kubectl delete namespace stuck-demo   (it will hang in Terminating)"
```

## Expected Failure

```bash
bash setup.sh
kubectl delete namespace stuck-demo
# namespace "stuck-demo" deleted    (command may hang or return, but...)

kubectl get namespace stuck-demo
# NAME         STATUS        AGE
# stuck-demo   Terminating   5m
```

```bash
kubectl get namespace stuck-demo -o jsonpath='{.status.conditions}' | tr ',' '\n'
# "NamespaceFinalizersRemaining" ... "Some content in the namespace has finalizers remaining: example.com/nonexistent-controller"
```

The ConfigMap's finalizer waits for a controller that does not exist to acknowledge
deletion. It never will, so the namespace never finishes terminating.

## Expected Outcome

The namespace deletes cleanly.

```bash
kubectl get namespace stuck-demo
# Error from server (NotFound): namespaces "stuck-demo" not found
```

The blocking resource's finalizer is removed (not the namespace force-finalized blindly):

```bash
# the finalizer on the ConfigMap is cleared, allowing normal GC to proceed
```

You can recreate the namespace afterward without conflict:

```bash
kubectl create namespace stuck-demo && kubectl delete namespace stuck-demo
# works normally now
```

## Hints

### Hint 1 — Find what still has finalizers

The namespace status names the remaining finalizers. Find the resources carrying them:

```bash
kubectl get namespace stuck-demo -o jsonpath='{.status.conditions[*].message}'
kubectl api-resources --verbs=list --namespaced -o name \
  | xargs -n1 kubectl get -n stuck-demo --ignore-not-found 2>/dev/null
```

Look for objects with `metadata.finalizers` set. Deletion is blocked until each finalizer
is removed by its controller — or by you, if the controller is gone.

### Hint 2 — Remove the finalizer from the resource, not the namespace

The correct fix is to clear the finalizer on the *resource* whose controller is missing:

```bash
kubectl patch configmap blocker -n stuck-demo \
  --type merge -p '{"metadata":{"finalizers":[]}}'
```

Prefer this over force-finalizing the namespace via the raw `/finalize` API, which can
orphan real resources. Only force the namespace when you are certain nothing else needs
cleanup.

## Solution

A finalizer waited on a controller that did not exist. Remove the finalizer from the
blocking resource, and the namespace's own garbage collection completes.

```bash
# identify and clear the offending finalizer
kubectl patch configmap blocker -n stuck-demo \
  --type merge -p '{"metadata":{"finalizers":[]}}'

# the namespace now finishes terminating on its own within moments
kubectl get namespace stuck-demo
# NotFound
```

If, and only if, you are certain no resource still needs cleanup, the namespace can be
force-finalized:

```bash
kubectl get namespace stuck-demo -o json \
  | jq 'del(.spec.finalizers)' \
  | kubectl replace --raw "/api/v1/namespaces/stuck-demo/finalize" -f -
```

- **`Terminating` forever means an unremoved finalizer.** The namespace status lists which
  ones; the blocker is a resource whose controller never acknowledged deletion.
- **Finalizers exist to run cleanup before deletion** — releasing a load balancer, deleting
  a cloud disk. Removing one by hand skips that cleanup, so only do it when the responsible
  controller is genuinely gone.
- **Fix the resource, not the namespace.** Clearing the finalizer on the blocking object
  lets normal garbage collection finish. Force-finalizing the namespace via `/finalize`
  bypasses everything and can orphan real cloud resources — a last resort.
- **The usual real cause is an uninstalled operator/CRD** whose custom resources still carry
  its finalizers. Reinstalling the controller briefly, letting it clean up, then uninstalling
  cleanly is the tidy fix when possible.
