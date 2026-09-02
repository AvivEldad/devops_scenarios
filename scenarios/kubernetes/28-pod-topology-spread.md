# The pods that all landed on one node

## Briefing

A 3-replica service is "highly available", but when one node rebooted, all three replicas
went down together — they were all scheduled onto the same node. In another case, pods will
not spread across zones despite a topology rule that looks correct.

There is no anti-affinity or topology spread constraint forcing distribution, or the spread
constraint uses `whenUnsatisfiable: ScheduleAnyway` (a soft hint the scheduler can ignore)
or a `topologyKey` the nodes are not labelled with. The replicas pile up and a single
failure takes them all.

## Your Task

- Deploy replicas and observe them all landing on one node (no real HA).
- Explain topology spread constraints, `topologyKey`, and hard vs soft satisfiability.
- Force the replicas to spread across nodes/zones so one failure cannot take them all.

## Starter Files

### file: app.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 3
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      # no topologySpreadConstraints, no podAntiAffinity ->
      # the scheduler may pack all 3 onto the emptiest node
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: "50m", memory: "32Mi" }
```

### file: broken-spread.yaml

```yaml
# A spread rule that does NOT actually enforce spreading:
apiVersion: apps/v1
kind: Deployment
metadata: { name: web2, namespace: default }
spec:
  replicas: 3
  selector: { matchLabels: { app: web2 } }
  template:
    metadata: { labels: { app: web2 } }
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: zone            # nodes are labelled topology.kubernetes.io/zone, not 'zone'
          whenUnsatisfiable: ScheduleAnyway   # soft: scheduler may ignore it
          labelSelector: { matchLabels: { app: web2 } }
      containers:
        - name: web2
          image: nginx:1.27-alpine
```

## Expected Failure

```bash
kubectl apply -f app.yaml
kubectl get pods -l app=web -o wide
# web-aaa   Running   node-1
# web-bbb   Running   node-1
# web-ccc   Running   node-1          <- all three on node-1: reboot it and the service dies
```

```bash
kubectl apply -f broken-spread.yaml
kubectl get pods -l app=web2 -o wide
# still clustered: topologyKey 'zone' matches no node label, and
# whenUnsatisfiable: ScheduleAnyway lets the scheduler place them anywhere
```

Nothing forced distribution: the first Deployment has no spread rule, and the second uses a
`topologyKey` the nodes do not carry plus a *soft* constraint the scheduler can disregard.
"3 replicas" is not HA if they share a failure domain.

## Expected Outcome

Replicas are spread across nodes (and zones), so one failure cannot take them all.

Pods land on distinct nodes:

```bash
kubectl get pods -l app=web -o wide
# web-aaa   node-1
# web-bbb   node-2
# web-ccc   node-3
```

The spread constraint uses a real `topologyKey` and is enforced:

```bash
kubectl get nodes -o jsonpath='{.items[*].metadata.labels.topology\.kubernetes\.io/zone}{"\n"}'
# the label the constraint references actually exists on nodes
```

A PodDisruptionBudget protects availability during voluntary disruptions:

```bash
kubectl get pdb web
# NAME   MIN AVAILABLE   ALLOWED DISRUPTIONS   AGE
# web    2               1                     1m
```

## Hints

### Hint 1 — Spread must be enforced against a real topology key

Use `topologySpreadConstraints` with a `topologyKey` that nodes actually carry —
`kubernetes.io/hostname` to spread across nodes, `topology.kubernetes.io/zone` across zones.
Check the labels with `kubectl get nodes --show-labels`. A key nodes do not have matches
nothing.

### Hint 2 — Hard vs soft, and protect with a PDB

`whenUnsatisfiable: DoNotSchedule` is a hard requirement (pods stay Pending rather than
clump); `ScheduleAnyway` is a soft hint the scheduler may ignore. Use `DoNotSchedule` (with
`maxSkew: 1`) to truly force spread, but ensure you have enough nodes or pods will go
Pending. Add a PodDisruptionBudget so drains/upgrades cannot take too many replicas at once.

## Solution

Force spread with a hard topology constraint on a real key, and protect availability with a
PDB.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 3
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname       # spread across nodes
          whenUnsatisfiable: DoNotSchedule          # hard requirement
          labelSelector: { matchLabels: { app: web } }
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone  # and across zones
          whenUnsatisfiable: ScheduleAnyway         # soft: prefer, but do not block
          labelSelector: { matchLabels: { app: web } }
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: "50m", memory: "32Mi" }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: web, namespace: default }
spec:
  minAvailable: 2
  selector: { matchLabels: { app: web } }
```

```bash
kubectl apply -f app.yaml
kubectl get pods -l app=web -o wide     # spread across nodes
```

- **Replica count is not availability.** Without a spread rule, the scheduler can pack all
  replicas onto one node; a single reboot then takes the whole service down. Distribution
  across failure domains is what makes it HA.
- **`topologyKey` must be a label the nodes actually have.** `kubernetes.io/hostname` for
  per-node spread, `topology.kubernetes.io/zone` for per-zone. A made-up key silently
  enforces nothing — verify with `--show-labels`.
- **Hard vs soft is decisive.** `DoNotSchedule` truly forces spread (pods pend if it cannot
  be met); `ScheduleAnyway` is only a preference the scheduler may ignore. Pick per how much
  you value spread vs schedulability.
- **Combine node-level (hard) and zone-level (soft)** so you always spread across nodes and
  prefer spreading across zones without going Pending when a zone is short on capacity.
- **Add a PodDisruptionBudget.** Spread handles *involuntary* failures; a PDB stops
  *voluntary* disruptions (drains, upgrades) from evicting too many replicas at once. You want
  both.
- **`podAntiAffinity` is the older tool** for the same goal; topology spread constraints are
  more expressive and are generally preferred now, but anti-affinity still works for strict
  "never co-locate" rules.
