# Sync failed and nobody was notified

## Briefing

`checkout` has been `SyncFailed` since Friday. Slack is quiet. On-call
heard from a user. Notifications are "installed": a ConfigMap, a
trigger, a webhook. The Application is not subscribed to
`on-sync-failed`, or the trigger condition never matches `Failed`, or
the service name does not match the subscribe annotation.

Keep this as config YAML. Fix trigger, template, service, and
subscription so a failed sync emits one message.

## Your Task

- Apply the notifications ConfigMap and a failing Application.
- Show a failed sync with no notification delivery.
- Correct trigger + subscribe annotation (or defaultTriggers).
- Force a failed sync and capture a delivered payload.

## Starter Files

### file: argocd-notifications-cm.yaml

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-notifications-cm
  namespace: argocd
data:
  service.webhook.ops: |
    url: https://example.invalid/argocd-hooks
  trigger.on-sync-succeeded: |
    - when: app.status.operationState.phase in ['Succeeded']
      send: [app-sync-ok]
  template.app-sync-ok: |
    webhook:
      ops:
        method: POST
        body: '{"app": "{{.app.metadata.name}}", "phase": "ok"}'
  defaultTriggers: |
    - on-sync-succeeded
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout
  namespace: argocd
  annotations:
    notifications.argoproj.io/subscribe.on-sync-succeeded.ops: ""
spec:
  project: default
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
```

### file: manifests/deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: checkout }
spec:
  selector: { matchLabels: { app: checkout } }
  template:
    metadata: { labels: { app: other } }
    spec:
      containers: [{ name: api, image: nginx:1.27-alpine }]
```

## Expected Failure

Selector mismatch → sync/health failure. Notifications controller:

```
Application checkout has no subscriptions
# or: trigger on-sync-succeeded evaluated false
```

```bash
argocd app get checkout
# Operation: Failed
# no webhook to ops
```

No `on-sync-failed` trigger. Subscribe annotation is success only.

## Expected Outcome

A failed operation sends `app-sync-failed` to service `ops`.

```bash
# notifications controller log
# Sending notification ... trigger=on-sync-failed service=webhook:ops
```

## Hints

### Hint 1 — Subscriptions are trigger + service names

```text
notifications.argoproj.io/subscribe.<trigger>.<service>: <recipients>
```

`subscribe.on-sync-succeeded.ops` never fires `on-sync-failed`. The
service key must match `service.webhook.ops` (`ops`).

### Hint 2 — `when:` must see Failed

`app.status.sync.status == 'OutOfSync'` is not operation `Failed`. Use
`app.status.operationState.phase in ['Error', 'Failed']` (or the
built-in `on-sync-failed` catalog trigger).

## Solution

```yaml
trigger.on-sync-failed: |
  - when: app.status.operationState.phase in ['Error', 'Failed']
    send: [app-sync-failed]
defaultTriggers: |
  - on-sync-failed
```

```yaml
notifications.argoproj.io/subscribe.on-sync-failed.ops: ""
```

Tokens live in `argocd-notifications-secret` — a 401 is credentials,
not this drill. Keep alerting until **git** is fixed.
