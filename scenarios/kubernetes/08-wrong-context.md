# kubectl points at the wrong cluster

## Briefing

You run `kubectl get pods` and see resources you do not recognise, or `No resources found`
in a namespace you know has workloads. Commands are landing on the wrong cluster or the
wrong namespace, and a deploy nearly went to production because of it.

The active context and default namespace are not what you assume. This is about knowing —
and controlling — where kubectl is pointed before you run anything.

## Your Task

- Determine which cluster and namespace kubectl is currently targeting.
- Explain why `get pods` showed nothing (or the wrong things).
- Set the context and namespace deliberately and confirm.

## Starter Files

### file: symptoms.md

```text
$ kubectl get pods
No resources found in default namespace.

# but the app is definitely deployed... in the 'staging' namespace,
# and possibly on a different cluster than the one currently selected.

$ kubectl config get-contexts
CURRENT   NAME                CLUSTER        NAMESPACE
*         prod-admin          prod           default
          staging-admin       staging        staging
```

## Expected Failure

```bash
kubectl get pods
# No resources found in default namespace.
```

The workloads are in the `staging` namespace on the `staging` cluster. The current context
is `prod-admin` with namespace `default`, so kubectl looked in the wrong place — and worse,
any `apply` right now would hit **production**.

## Expected Outcome

kubectl targets the intended cluster and namespace, verified before acting.

The current context and namespace are known:

```bash
kubectl config current-context
# staging-admin
kubectl config view --minify -o jsonpath='{..namespace}{"\n"}'
# staging
```

Commands return the expected resources:

```bash
kubectl get pods
# the staging workloads appear
```

The default namespace is set so you do not need `-n` every time:

```bash
kubectl config set-context --current --namespace=staging
kubectl get pods    # now defaults to staging
```

## Hints

### Hint 1 — Always know your context and namespace

```bash
kubectl config current-context
kubectl config get-contexts
kubectl config view --minify | grep namespace
```

`get pods` with no `-n` uses the context's default namespace (often `default`). "No
resources found" usually means right cluster, wrong namespace — or the wrong cluster
entirely.

### Hint 2 — Switch deliberately

```bash
kubectl config use-context staging-admin
kubectl config set-context --current --namespace=staging
```

Tools like `kubectx`/`kubens`, or a shell prompt that shows the current context, prevent
the "I thought I was on staging" class of accident. Consider them mandatory before you have
access to production.

## Solution

kubectl was on the `prod` context in the `default` namespace; the workloads were on
`staging`.

```bash
kubectl config use-context staging-admin
kubectl config set-context --current --namespace=staging

kubectl config current-context      # staging-admin
kubectl get pods                    # staging workloads
```

To target once without switching:

```bash
kubectl --context staging-admin -n staging get pods
```

- **kubectl always acts on the current context and namespace.** "No resources found" and
  "unfamiliar resources" both usually mean it is pointed somewhere other than you think —
  check before you run anything that writes.
- **`--minify` shows only the active context**, the fastest way to confirm cluster, user and
  namespace together.
- **Set the namespace on the context** so routine commands do not need `-n`, but keep `-n`
  explicit in scripts and docs where the target must be unambiguous.
- **Make the current context visible.** A prompt segment or `kubectx`/`kubens` turns "which
  cluster am I on?" from a guess into a glance — the single best defence against running a
  destructive command on production by mistake.
- **Separate kubeconfigs or per-shell `KUBECONFIG`** for prod vs non-prod add a real barrier
  when the stakes justify it.
