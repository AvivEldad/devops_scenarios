# receive.denyCurrentBranch: the push to a non-bare repo

## Briefing

You `git push` to a colleague's checkout (or a server repo that is not `--bare`)
and git rejects: `refusing to update checked out branch: refs/heads/main` and
`receive.denyCurrentBranch`. Or an older git **accepts** the push and the server
working tree is now out of sync with `HEAD` — files on disk are the old tree, HEAD
is the new one, and the next commit on the server is a disaster.

Pushing into a non-bare repository is a special case. Bare repos (`*.git`, no
working tree) exist so the checked-out branch problem cannot happen.

## Your Task

- Push into a non-bare repo and hit `denyCurrentBranch`.
- Explain why the default is to refuse.
- Use a bare remote, or `updateInstead` / a receive hook, without leaving a
  desynced working tree.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf server client
git init -q -b main server
git -C server config user.email "srv@example.com"
git -C server config user.name "Server"
echo "srv" > server/app.txt && git -C server add app.txt && git -C server commit -qm "server"
git clone -q server client
git -C client config user.email "you@example.com"
git -C client config user.name "You"
cd client
echo "from client" >> app.txt && git commit -qam "client change"
echo "now: git push origin main"
```

## Expected Failure

```bash
bash setup.sh
cd client
git push origin main
# remote: error: refusing to update checked out branch: refs/heads/main
# remote: error: By default, updating the current branch in a non-bare repository
# To .../server
# ! [remote rejected] main -> main (branch is currently checked out)
```

If someone set `receive.denyCurrentBranch=ignore` (old default behaviour):

```bash
# server: HEAD is new commit, working tree still "srv" only — git status on server is dirty/inverted
```

## Expected Outcome

The remote is bare (or updates the working tree atomically via `updateInstead`),
and `git push` succeeds without a desynced tree.

```bash
git init --bare server.git
git remote set-url origin ../server.git
git push -u origin main
```

Or on a deployment checkout (carefully):

```bash
git -C server config receive.denyCurrentBranch updateInstead
git push origin main
# working tree on server matches HEAD
```

## Hints

### Hint 1 — Bare is the remote you want

`git clone --bare` / `git init --bare`. No working tree, no current branch
checkout, pushes only update refs. Hosted Git (GitHub) is always this model.

### Hint 2 — updateInstead vs ignore

`denyCurrentBranch=refuse` (default): safe. `ignore`/`false`: update the ref,
leave the working tree — **dangerous**. `updateInstead`: try to update the working
tree if it is clean. `updateInstead` still loses uncommitted server-side edits.
A `post-receive` hook that `git checkout -f` is a common deploy pattern — on a
**dedicated** deploy clone, not a human's working copy.

## Solution

Push to a bare repository; do not use a human checkout as `origin`.

```bash
git clone --bare server server.git
git -C client remote set-url origin ../server.git
git -C client push origin main
```

For a deploy directory, prefer pulling on the server (`git pull` in a hook) or
`updateInstead` only if you understand dirty-tree failure modes.

- **Non-bare + push = two owners of the same working tree.** Git refuses by
  default for a reason.
- **Deployment:** `post-receive` + `GIT_WORK_TREE` checkout, or a CI that rsyncs
  artifacts — not `git push` to prod's `/var/www` checkout unless it is dedicated.
- **`receive.denyCurrentBranch=updateInstead`** is the least-bad non-bare option
  and still not a backup strategy.
- **SSH "repos" on a VM should be bare** under `~/git/app.git` with `authorized_keys`
  wrapping `git-shell`.
