# rerere keeps applying a bad merge resolution

## Briefing

You resolved a conflict wrongly once. Every later rebase/merge of the same hunks
applies that resolution automatically and the bug returns. `git rerere` (reuse
recorded resolution) is enabled; it recorded the mistake. Or the opposite: you
fixed a conflict carefully and the next merge makes you do it again because rerere
was off.

Rerere is a cache of preimage → postimage. It does not know if the resolution was
correct.

## Your Task

- Enable rerere, record a bad resolution, merge again, and see it reused.
- Forget the recorded resolution.
- Re-resolve correctly and keep rerere for the good one.

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
git config rerere.enabled true
printf 'a\nshared\nb\n' > f.txt
git add f.txt && git commit -qm "base"
git checkout -qb side
printf 'a\nSIDE\nb\n' > f.txt && git commit -qam "side"
git checkout main
printf 'a\nMAIN\nb\n' > f.txt && git commit -qam "main"
echo "merge side, resolve WRONG (keep MAIN only), commit"
echo "reset, merge again — rerere will replay the wrong resolution"
```

## Expected Failure

```bash
bash setup.sh
cd lab
git merge side || true
# resolve by taking only MAIN
printf 'a\nMAIN\nb\n' > f.txt
git add f.txt && git commit -m "merge side"
git reset --hard HEAD~1
git merge side
# Auto-merging f.txt
# Recorded preimage for 'f.txt'
# Resolved 'f.txt' using previous resolution     <- silent wrong merge
cat f.txt
# MAIN only; SIDE lost again
```

The second merge may not even stop for a conflict.

## Expected Outcome

The recorded bad resolution is gone; the next merge conflicts (or uses a *good*
recording).

```bash
git rerere forget f.txt
git merge --abort 2>/dev/null || true
git merge side
# CONFLICT — you must edit again
```

After a correct combine, rerere helps later:

```bash
cat f.txt
# a
# MAIN
# SIDE
# b
```

## Hints

### Hint 1 — rr-cache

`.git/rr-cache/` holds the recordings. `git rerere remaining` / `git rerere status`
during a conflict. `git rerere forget <path>` drops one file's cache. Disabling
`rerere.enabled` stops new recordings; old ones can still apply until forgotten.

### Hint 2 — See what it will apply

During a conflict with rerere on, look at the file *before* `git add` — if it is
already "resolved" without markers, rerere did it. `git checkout --conflict=merge
-- f.txt` restores markers if you need to redo.

## Solution

Forget the bad cache entry, merge again, resolve by combining both sides.

```bash
git rerere forget f.txt
git merge --abort || git reset --hard
git merge side
# edit f.txt to include MAIN and SIDE
git add f.txt
git commit
```

- **Rerere is a sharp tool on long-lived branches** (release vs main). It also
  cements mistakes. Review auto-resolutions in the PR diff.
- **`rerere.autoupdate`** stages the reuse automatically — even less visibility.
  Leave it off until you trust the cache.
- **Conflict markers disappearing instantly** is the tell. Do not assume git
  "understood" the code.
- **`forget` is per path**, not per branch. A bad record affects every future
  merge of that hunk.
