# The admission webhook that blocked the whole cluster

## Briefing

Every `kubectl apply` — even to `kube-system` — suddenly fails with an error about calling a
webhook, or new pods will not schedule anywhere. A validating/mutating admission webhook was
installed, and now it is on the critical path for operations it cannot service.

The webhook's `failurePolicy: Fail` combined with too-broad a `scope` (or a webhook backend
that is down) means the API server rejects requests it cannot get an admission decision for
— including the requests needed to fix the webhook itself.

## Your Task

- Reproduce a cluster where a broken admission webhook blocks normal operations.
- Explain how `failurePolicy`, `namespaceSelector`, and `objectSelector` control blast
  radius.
- Recover the cluster and reconfigure the webhook so it can never wedge everything again.

## Starter Files

### file: bad-webhook.yaml

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: policy-guard
webhooks:
  - name: policy.example.com
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail            # if the backend is unreachable, DENY the request
    rules:
      - apiGroups: ["*"]
        apiVersions: ["*"]
        operations: ["CREATE", "UPDATE"]
        resources: ["*"]           # everything, in every namespace
        scope: "*"
    clientConfig:
      service:
        name: policy-guard         # a Service whose pods are NOT running
        namespace: policy-system
        path: /validate
      # caBundle: <...>
    # no namespaceSelector -> also intercepts kube-system, cert-manager, itself
```

## Expected Failure

```bash
kubectl apply -f bad-webhook.yaml   # the backend pods do not exist

kubectl apply -f anything.yaml
# Error from server (InternalError): Internal error occurred:
# failed calling webhook "policy.example.com": failed to call webhook:
# Post "https://policy-guard.policy-system.svc:443/validate": no endpoints available
```

```bash
# even fixing things is blocked, because the fix is a CREATE/UPDATE the webhook intercepts:
kubectl -n policy-system apply -f deploy-the-backend.yaml
# ... failed calling webhook "policy.example.com" ...
```

With `failurePolicy: Fail` and no `namespaceSelector`, the API server must consult the
webhook for nearly every write. The backend is down, so every write is denied — including
the writes that would deploy the backend. The cluster is wedged.

## Expected Outcome

The cluster accepts writes again, and the webhook is scoped so it cannot self-lock.

Normal applies work:

```bash
kubectl apply -f anything.yaml
# resource created/configured
```

The webhook excludes control-plane and its own namespace, and fails safe where appropriate:

```bash
kubectl get validatingwebhookconfiguration policy-guard -o yaml | grep -A6 namespaceSelector
# excludes kube-system and policy-system (e.g. via a label selector)
```

The webhook backend is healthy before the webhook is enforced:

```bash
kubectl -n policy-system get pods
# policy-guard backend Running with endpoints
kubectl -n policy-system get endpoints policy-guard
# addresses listed
```

## Hints

### Hint 1 — Recover by removing the webhook first

You cannot deploy the fix while the webhook denies writes. Delete (or disable) the webhook
configuration — that is not itself intercepted:

```bash
kubectl delete validatingwebhookconfiguration policy-guard
```

Now deploy the backend, confirm it is healthy, then re-add the webhook. Deleting the
`...WebhookConfiguration` object is the emergency brake.

### Hint 2 — Scope it and fail safe

- `namespaceSelector` to **exclude** `kube-system` and the webhook's own namespace (label
  those namespaces and match on the label) so it can never block control-plane or its own
  recovery.
- Narrow `rules` to the specific resources you actually govern, not `*/*`.
- Consider `failurePolicy: Ignore` for non-security policies so a backend outage degrades to
  "not enforced" rather than "cluster down"; keep `Fail` only where a bypass is unacceptable,
  and then run the backend HA.

## Solution

Remove the webhook to unwedge, deploy and verify the backend, then re-add a tightly scoped,
fail-considered configuration.

```bash
# 1) emergency: stop the bleeding
kubectl delete validatingwebhookconfiguration policy-guard

# 2) deploy and verify the backend
kubectl apply -f policy-backend.yaml
kubectl -n policy-system rollout status deploy/policy-guard
kubectl -n policy-system get endpoints policy-guard   # has addresses
```

```yaml
# 3) re-add, scoped and safe
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: policy-guard
webhooks:
  - name: policy.example.com
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Ignore                 # degrade to 'not enforced' if backend is down
    timeoutSeconds: 5
    namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: NotIn
          values: ["kube-system", "policy-system"]   # never touch control-plane or self
    rules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]               # only what you actually govern
        scope: "Namespaced"
    clientConfig:
      service: { name: policy-guard, namespace: policy-system, path: /validate }
```

- **An admission webhook is on the write path.** With `failurePolicy: Fail` and a broad
  scope, a down backend denies nearly every write — including the writes that would fix it.
  This is one of the fastest ways to wedge an entire cluster.
- **Delete the WebhookConfiguration to recover.** That object's own deletion is not
  intercepted, so it is the emergency brake. Then deploy the backend and re-enable.
- **Always exclude control-plane and self.** A `namespaceSelector` that excludes `kube-system`
  and the webhook's own namespace guarantees it can never block cluster operation or its own
  recovery.
- **Choose `failurePolicy` deliberately.** `Ignore` fails open (policy not enforced during an
  outage — safe for most guardrails); `Fail` fails closed (no bypass — necessary for hard
  security controls, but then run the backend HA with a tight `timeoutSeconds`).
- **Scope `rules` narrowly.** Intercept only the resources/operations you actually validate,
  not `*/*/*`. Every extra resource is more blast radius and more latency on the API path.
- **Test webhooks in a non-critical namespace first**, and monitor backend availability — a
  webhook you cannot see failing is a cluster outage waiting to happen.
