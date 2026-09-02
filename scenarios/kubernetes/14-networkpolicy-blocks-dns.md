# The pod that cannot talk after the network policy landed

## Briefing

A security team applied NetworkPolicies to a namespace. Now one app cannot reach the
database, and DNS lookups intermittently fail across the namespace. The policies look
reasonable in isolation.

NetworkPolicies are additive and default-deny once any policy selects a pod. A policy that
allows app traffic but forgets DNS (egress to kube-dns) breaks name resolution for every
pod it selects.

## Your Task

- Apply the policies and reproduce both the DB connection failure and the DNS failure.
- Explain how NetworkPolicy default-deny interacts with these rules.
- Fix the policies so the app reaches the DB and DNS works, without opening everything.

## Starter Files

### file: policy.yaml

```yaml
# Once this selects the pod, ALL egress not explicitly allowed is denied -
# including DNS to kube-dns on port 53.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress
  namespace: shop
spec:
  podSelector:
    matchLabels: { app: api }
  policyTypes: ["Egress"]
  egress:
    - to:
        - podSelector:
            matchLabels: { app: db }
      ports:
        - protocol: TCP
          port: 5432
    # no rule for DNS (UDP/TCP 53 to kube-system) -> name resolution breaks
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-ingress
  namespace: shop
spec:
  podSelector:
    matchLabels: { app: db }
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels: { app: web }   # allows 'web', but the caller is 'api'
      ports:
        - protocol: TCP
          port: 5432
```

## Expected Failure

```bash
kubectl -n shop exec deploy/api -- nslookup db
# ;; connection timed out; no servers could be reached      <- DNS blocked by egress policy

kubectl -n shop exec deploy/api -- sh -c 'nc -z -w3 db 5432; echo $?'
# 1                                                          <- DB ingress does not allow 'api'
```

Two independent breakages: the egress policy omits DNS, so `api` cannot resolve names at
all; and the DB ingress policy allows `web` but not `api`, so even by IP the connection is
refused.

## Expected Outcome

The app resolves names and reaches the database; nothing else is opened.

DNS works from the selected pod:

```bash
kubectl -n shop exec deploy/api -- nslookup db
# Address: 10.x.x.x
```

The DB connection succeeds:

```bash
kubectl -n shop exec deploy/api -- sh -c 'nc -z -w3 db 5432; echo $?'
# 0
```

Unrelated egress stays denied (default-deny still in force for everything not allowed):

```bash
kubectl -n shop exec deploy/api -- sh -c 'nc -z -w3 1.1.1.1 443; echo $?'
# 1   (still blocked - we did not open the world)
```

## Hints

### Hint 1 — A selected pod is default-deny for that direction

The moment a NetworkPolicy with `policyTypes: [Egress]` selects a pod, *all* egress is
denied except what you list — including DNS. Almost every egress policy needs an explicit
allow for UDP/TCP 53 to the kube-dns pods in `kube-system`.

### Hint 2 — Ingress must name the real client

The DB ingress allowed `app=web`, but the caller is `app=api`. Ingress rules match the
*source* pod's labels (and optionally namespace). List the actual client. Test reachability
with `nc -z` and name resolution with `nslookup` separately — they fail for different
reasons.

## Solution

Add a DNS egress allow, and fix the DB ingress to permit the real client.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress
  namespace: shop
spec:
  podSelector:
    matchLabels: { app: api }
  policyTypes: ["Egress"]
  egress:
    - to:
        - podSelector:
            matchLabels: { app: db }
      ports:
        - { protocol: TCP, port: 5432 }
    - to:                                   # allow DNS to kube-dns
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-ingress
  namespace: shop
spec:
  podSelector:
    matchLabels: { app: db }
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels: { app: api }       # the real caller
      ports:
        - { protocol: TCP, port: 5432 }
```

- **NetworkPolicy is default-deny once it selects a pod** — for the directions listed in
  `policyTypes`. Everything not explicitly allowed is dropped, which is the point, but it
  catches DNS constantly.
- **Almost every egress policy needs a DNS allow** to kube-dns on port 53 (UDP and TCP).
  Forgetting it produces mysterious "cannot resolve" failures that look like DNS outages.
- **Ingress rules match the source's labels/namespace** — name the actual client, not a
  neighbour. `web` vs `api` is exactly the kind of drift that silently blocks traffic.
- **Diagnose in layers**: `nslookup` tests DNS (egress 53), `nc -z host port` tests TCP
  reachability (the specific allow rule). They fail independently; test both.
- **Policies are additive with no priority.** You cannot write a "deny" rule; you restrict by
  *not* allowing. Combine narrow allow-rules rather than trying to carve exceptions.
- **Requires a CNI that enforces NetworkPolicy** (Calico, Cilium, etc.). On a CNI that
  ignores them, the policies apply cleanly and change nothing — verify enforcement is real.
