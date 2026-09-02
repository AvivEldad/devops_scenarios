# Manual sync refused during a deny window

## Briefing

Checkout is `OutOfSync`. Git has the fix. `argocd app sync checkout`
returns a deny. The UI button is grey. The AppProject has a **sync
window** of kind `deny` that covers now.

Windows are for change freezes. They also block the one sync you need
unless `manualSync: true` or the window is the wrong timezone /
schedule.

## Your Task

- Apply the project with the deny window and the OutOfSync app.
- Show sync is blocked (auto and manual).
- Open a legitimate path: expire/fix the window, or `manualSync: true`
  plus an explicit sync, per policy.
- The app must reach Synced without waiting for Monday.

## Starter Files

### file: appproject.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: shop
  namespace: argocd
spec:
  sourceRepos: ["*"]
  destinations:
    - { namespace: "*", server: "*" }
  syncWindows:
    - kind: deny
      schedule: "0 0 * * *"
      duration: 24h
      applications: ["*"]
      manualSync: false
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout
  namespace: argocd
spec:
  project: shop
  source:
    repoURL: https://github.com/YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
argocd app sync checkout
# FATA[0000] Blocked by sync window

argocd proj windows list shop
# KIND  SCHEDULE    DURATION  APPLICATIONS  MANUALSYNC
# deny  0 0 * * *   24h       [*]           false

argocd app get checkout
# Sync Status: OutOfSync
```

Auto-sync is idle. The fix sits on `main`.

## Expected Outcome

```bash
argocd proj windows list shop
# deny gone, or manualSync: true, or kind: allow covering now

argocd app sync checkout
argocd app get checkout
# Sync Status:   Synced
# Health Status: Healthy
```

## Hints

### Hint 1 — `kind: deny` plus `duration: 24h` is a permanent freeze

`schedule: "0 0 * * *"` every day at 00:00 UTC with `duration: 24h` is
"never". Cron is UTC unless you set `timeZone`. A freeze meant for Fri
18:00–Mon 08:00 local is often wrong in UTC.

### Hint 2 — `manualSync: true` is the break-glass bit

With `manualSync: true`, auto-sync stays blocked and `argocd app sync`
is allowed. Use that for "no unattended deploys on weekends" without
making incidents unfixable.

## Solution

If the freeze is accidental, clear it (`syncWindows: []`). If weekends
must not auto-deploy, keep deny and permit humans:

```yaml
syncWindows:
  - kind: deny
    schedule: "0 18 * * 5"
    duration: 62h
    timeZone: Europe/London
    applications: [checkout]
    manualSync: true
```

```bash
kubectl apply -f appproject.yaml
argocd app sync checkout
```

- **Windows live on the AppProject**, not the Application. `"*"` is how
  this outage went global.
- **Do not patch live Deployments** to sneak around a freeze. Either the
  window is wrong, or you are bypassing the change policy.
