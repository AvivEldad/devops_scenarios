# Private repo, 401, credentials Secret does not match the URL

## Briefing

`checkout` ComparisonError: `authentication required` / `401` / SSH
failure. The git remote is private. A repository Secret exists in
`argocd`. The `url` on the Secret does not match `spec.source.repoURL`
(https vs ssh, missing `.git`, wrong org), or `type` is `helm` for a
git source.

Argo does not use your laptop's `gh auth`. Repo-server uses Secrets
labelled `argocd.argoproj.io/secret-type: repository` (or `repo-creds`
for URL prefixes).

## Your Task

- Point the Application at a private URL; apply the mismatched Secret.
- Capture 401 / auth required on the Application.
- Fix the Secret (URL, protocol, username/password or sshPrivateKey).
- Hard refresh until ComparisonError is gone and sync works.

## Starter Files

### file: repo-secret.yaml

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: repo-checkout
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
type: Opaque
stringData:
  type: helm
  url: https://github.com/YOUR-USER/other-repo.git
  username: git
  password: ghp_not-the-token-for-this-repo
```

### file: application.yaml

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: checkout
  namespace: argocd
spec:
  project: default
  source:
    repoURL: git@github.com:YOUR-USER/YOUR-REPO.git
    targetRevision: main
    path: manifests
  destination: { server: https://kubernetes.default.svc, namespace: shop }
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
```

## Expected Failure

```bash
argocd app get checkout
# ComparisonError: failed to get git client for repo
# git@github.com:YOUR-USER/YOUR-REPO.git: authentication required

argocd repo list
# TYPE  REPO                                         STATUS
# helm  https://github.com/YOUR-USER/other-repo.git  Failed
```

HTTPS token will not authenticate `git@github.com:...`. Helm type will
not clone a git directory app.

## Expected Outcome

```bash
argocd repo list
# TYPE  REPO                                    STATUS
# git   git@github.com:YOUR-USER/YOUR-REPO.git  Successful

argocd app get checkout
# Sync Status:   Synced
# Health Status: Healthy
```

## Hints

### Hint 1 — Protocol of `repoURL` must match the Secret

HTTPS: `url`, `username`, `password` (PAT). SSH: `url:
git@github.com:org/repo.git`, `sshPrivateKey`. A HTTPS Secret is
invisible to an SSH Application URL. `repo-creds` prefix Secrets use
`url: git@github.com:YOUR-USER` for a whole org.

### Hint 2 — `type: git` vs `helm`

Directory/Kustomize/Helm-from-git sources need `type: git`. `type:
helm` is for chart repositories. Wrong type looks like auth failure or
"not a helm repo".

## Solution

Align URL, type, and credential material with the Application:

```yaml
stringData:
  type: git
  url: git@github.com:YOUR-USER/YOUR-REPO.git
  sshPrivateKey: |
    -----BEGIN OPENSSH PRIVATE KEY-----
    ...
    -----END OPENSSH PRIVATE KEY-----
```

For HTTPS, change **both** Application `repoURL` and Secret `url` to
`https://github.com/YOUR-USER/YOUR-REPO.git` and set a PAT.

```bash
kubectl -n argocd apply -f repo-secret.yaml
argocd app get checkout --hard-refresh
```

- **AppProject `sourceRepos`** must allow this URL too. Do not put PATs
  in the Application YAML. Cloning on your laptop proves nothing about
  repo-server.
