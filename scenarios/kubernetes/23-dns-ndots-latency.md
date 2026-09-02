# The DNS that resolves everything except the one service you need

## Briefing

Pods can resolve `kubernetes.default` and external names, but one Service name resolves
slowly, intermittently, or not at all. Under load, DNS latency spikes and requests time out
before the lookup returns.

Two classic causes: an application using a short DNS timeout hitting CoreDNS under load
(worsened by the `ndots:5` search-path expansion that turns one lookup into many), and a
CoreDNS/upstream misconfiguration for a specific zone. The app is fine; resolution is the
bottleneck.

## Your Task

- Reproduce slow or failing resolution for a Service name from inside a pod.
- Explain how `ndots:5` and the search path multiply lookups, and where CoreDNS fits.
- Reduce the lookups and stabilise resolution.

## Starter Files

### file: probe.yaml

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dnsprobe
  namespace: default
spec:
  containers:
    - name: probe
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
  # default dnsConfig -> ndots:5, full search path
```

### file: notes.md

```text
Inside the pod, /etc/resolv.conf looks like:
  nameserver 10.96.0.10
  search default.svc.cluster.local svc.cluster.local cluster.local
  options ndots:5

With ndots:5, a lookup for an EXTERNAL name like "api.example.com" (3 dots < 5)
is first tried as:
  api.example.com.default.svc.cluster.local   (NXDOMAIN)
  api.example.com.svc.cluster.local           (NXDOMAIN)
  api.example.com.cluster.local               (NXDOMAIN)
  api.example.com                             (finally resolves)
= 4 queries instead of 1, multiplied across every request under load.
```

## Expected Failure

```bash
kubectl apply -f probe.yaml
kubectl exec dnsprobe -- sh -c 'time nslookup api.example.com'
# ... several NXDOMAIN attempts before the real answer; slow under load
```

```bash
# watch the query amplification
kubectl exec dnsprobe -- cat /etc/resolv.conf
# options ndots:5   <- every name with <5 dots walks the whole search list first
```

`ndots:5` means any name with fewer than 5 dots is tried against each search-domain suffix
before being tried as-is. For external names that is several guaranteed NXDOMAINs per
lookup; at scale this floods CoreDNS and shows up as DNS latency and timeouts.

## Expected Outcome

Resolution is fast and reliable; lookups per request drop.

For external names, use a fully-qualified name (trailing dot) or a lower `ndots` so the
search path is not walked:

```bash
kubectl exec dnsprobe -- sh -c 'time nslookup api.example.com.'
# single query, fast (the trailing dot means "fully qualified, do not append search domains")
```

For in-cluster calls, use the full Service DNS name to hit on the first try:

```bash
kubectl exec dnsprobe -- nslookup web.default.svc.cluster.local
# resolves in one query
```

CoreDNS is healthy and not overloaded:

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns
# Running, low restart count
kubectl -n kube-system logs -l k8s-app=kube-dns | tail
# no SERVFAIL storms
```

## Hints

### Hint 1 — ndots and the search path multiply queries

`options ndots:5` makes any name with <5 dots be tried with each `search` suffix first. For
external hostnames this guarantees multiple NXDOMAINs before the real lookup. Fix per-pod
with a `dnsConfig` setting `ndots:2` (or lower), or fully-qualify names with a trailing dot
so the search path is skipped entirely.

### Hint 2 — Fully-qualify and check CoreDNS

In-cluster, prefer `svc.namespace.svc.cluster.local` to resolve in one query. Watch CoreDNS
health and load (`kubectl -n kube-system logs -l k8s-app=kube-dns`); NodeLocal DNSCache
dramatically cuts latency and load at scale by caching on each node. A specific zone failing
usually points to a CoreDNS `Corefile` `forward`/`hosts` misconfig.

## Solution

Cut the query amplification: lower `ndots` for pods that mostly call external names, and
fully-qualify hot names. Verify CoreDNS is healthy.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dnsprobe
  namespace: default
spec:
  dnsConfig:
    options:
      - name: ndots
        value: "2"          # names with >=2 dots skip the search-path walk
  containers:
    - name: probe
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
```

```bash
# fully-qualify to guarantee a single query:
#   external:   api.example.com.        (trailing dot)
#   in-cluster: web.default.svc.cluster.local
# at scale, deploy NodeLocal DNSCache to cache per-node and offload CoreDNS
```

- **`ndots:5` is the usual culprit for DNS latency.** Every name shorter than 5 dots is tried
  against the whole search path first, so external lookups pay several NXDOMAINs each — brutal
  under load. Lower `ndots` per-pod via `dnsConfig`, or fully-qualify names.
- **A trailing dot means "fully qualified"** — the resolver skips the search path and does
  one query. For hot external endpoints, `host.example.com.` is a cheap fix.
- **In-cluster, use the full Service name** `service.namespace.svc.cluster.local` to resolve
  on the first attempt instead of walking suffixes.
- **CoreDNS is a Deployment you can scale and inspect.** Check its logs for SERVFAIL storms,
  scale replicas, and review the `Corefile` when a specific zone misbehaves.
- **NodeLocal DNSCache** puts a caching resolver on every node, slashing tail latency and
  CoreDNS load — the standard fix for DNS problems that only appear at scale.
