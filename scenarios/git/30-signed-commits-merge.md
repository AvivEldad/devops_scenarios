# signed commit, unsigned merge, broken verify

## Briefing

The team requires signed commits (`commit.gpgsign`, GitHub "verified"). Your
feature commits are green checkmarks. After merge, `main` shows an **unsigned merge
commit** or "Unverified", and a protected-branch rule that requires signatures
rejects the merge queue. Rebase-and-merge vs squash vs merge commit treat signing
differently; web-merge on GitHub is signed by GitHub's bot, not you.

Signing is per commit object. A merge created on the server is a new object. SSH
signing vs GPG vs S/MIME also disagree with what "Verified" means.

## Your Task

- Create signed commits (or simulate `gpgsign` failure) and a merge that is not
  signed.
- See which git/GitHub settings would reject the result.
- Sign the merge locally (`git merge -S`) or choose squash/rebase so every commit
  on `main` remains signed.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
# no GPG key in this lab — signing will fail or be skipped
git config commit.gpgsign true
echo "v1" > app.txt && git add app.txt
echo "git commit -m 'signed?'  may fail: gpg failed to sign the data"
echo "then: git config commit.gpgsign false; commit; merge without -S"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git commit -m "feature"
# error: gpg failed to sign the data
# fatal: failed to write commit object
```

After disabling sign to get work done:

```bash
git config commit.gpgsign false
git commit -m "feature"
git checkout -b other && echo x >> app.txt && git commit -qam "other"
git checkout main && git merge --no-edit other
git log --show-signature -1
# (no signature)
```

GitHub branch protection "Require signed commits" rejects unsigned merges from a
laptop; the GitHub UI merge may still be "verified" as `web-flow`.

## Expected Outcome

Commits you create are signed with a working key (GPG or SSH), and the merge
strategy preserves the policy.

```bash
git log --show-signature -1
# gpg: Good signature from "You <you@example.com>"
# or: Good "git" signature with SSH key ...
```

`git config gpg.format ssh` + `signingkey ~/.ssh/id_ed25519.pub` is often easier
than GPG in CI.

## Hints

### Hint 1 — Why gpg failed to sign

`gpg --list-secret-keys`, `echo test | gpg --clearsign`, `GIT_TRACE=1 git commit`.
Usual causes: no key, `gpg.program` wrong, pinentry cannot prompt in CI/SSH,
`user.signingkey` does not match. `export GPG_TTY=$(tty)` for pinentry.

### Hint 2 — Merge strategies vs signatures

**Merge commit:** new unsigned object unless `merge -S` / GitHub signs as
web-flow. **Squash:** one new commit, signed if the merger signs. **Rebase and
merge:** replays commits; GitHub rewrites them and can sign as GitHub.
`git merge --verify-signatures` refuses unsigned *incoming* commits. Protected
branches need a consistent choice.

## Solution

Get signing working, then merge with `-S` (or squash on a signer).

```bash
# SSH signing (Git 2.34+)
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git config commit.gpgsign true
echo "you@example.com namespaces=\"git\" $(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers
git config gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers

git commit -S -m "feature"
git merge -S --no-edit other
git log --show-signature -2
```

- **Verified on GitHub ≠ your key** if the merge happened in the UI — it is
  GitHub's key. That can still satisfy "require signed commits".
- **CI cannot sign with a key it does not have.** Either unsigned bot commits
  (allowlist) or a signing subkey in the secrets store — treat that key as prod
  credential.
- **`commit.gpgsign=true` globally** plus no pinentry is why "git commit works in
  the GUI and fails in SSH". Fix GPG_TTY or use SSH signing.
- **Expired GPG keys** become Unverified overnight. Calendar that like cert
  expiry.
