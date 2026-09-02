# Git LFS showed me a 130-byte "image" in production

## Briefing

The site's hero PNG is 130 bytes and `file` says `ASCII text`. Opening it shows:

```
version https://git-lfs.github.com/spec/v1
oid sha256:...
size 2400112
```

Git LFS stores a **pointer** in git and the real blob on an LFS server. If `git lfs
install` / `smudge` did not run, or CI checked out without LFS, or someone committed
the pointer without pushing the object, production gets the pointer file.

## Your Task

- Commit a file through LFS (or simulate the pointer) and check out without smudge.
- Recognise a pointer versus a real binary.
- Fetch the real object and make checkout smudge correctly.

## Starter Files

### file: pointer.png

```text
version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d47e1ba1
size 1024
```

### file: setup.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
rm -rf lab && mkdir lab && cd lab
git init -q -b main
git config user.email "you@example.com"
git config user.name "You"
# simulate what git stores when LFS is not smudging:
cp ../pointer.png hero.png 2>/dev/null || printf '%s\n' \
  'version https://git-lfs.github.com/spec/v1' \
  'oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d47e1ba1' \
  'size 1024' > hero.png
git add hero.png && git commit -qm "add hero (pointer only if lfs missing)"
echo "file hero.png; wc -c hero.png"
```

## Expected Failure

```bash
bash setup.sh
cd lab
file hero.png
# ASCII text
head -1 hero.png
# version https://git-lfs.github.com/spec/v1
wc -c hero.png
# 130
```

The real image was never in this working tree. A web server will send the pointer
as `image/png` and browsers will break. CI that does not run `git lfs pull` ships
the same thing.

## Expected Outcome

The working tree file is the real object (size matches `size` in the pointer), or
you fail the build if LFS is required and the object is missing.

```bash
git lfs install
git lfs pull
file hero.png
# PNG image data ...
wc -c hero.png
# 1024   (or the real size)
```

CI checkout uses LFS:

```yaml
# actions/checkout with lfs: true
```

## Hints

### Hint 1 — Pointers are three lines of text

`head -3` / `file` / a size of ~130 bytes on a "PNG" is the fingerprint. `git lfs
ls-files` lists tracked paths. `git lfs smudge` is what replaces the pointer on
checkout when filters are installed (`git lfs install`).

### Hint 2 — Push the objects, not just the pointers

`git push` without LFS credentials / `git lfs push --all` missing means GitHub has
the pointer commit and not the blob. Another clone gets a pointer and `git lfs pull`
fails with `Object does not exist on the server`. Confirm with `git lfs fsck`.

## Solution

Install LFS filters, pull objects, and make CI do the same. Fail if a pointer leaks.

```bash
git lfs install
git lfs pull
git lfs ls-files
file hero.png
```

Add a check:

```bash
# fail CI if a "binary" is still a pointer
if grep -q 'git-lfs.github.com' hero.png; then echo "LFS pointer shipped"; exit 1; fi
```

In GitHub Actions: `actions/checkout@v4` with `lfs: true`.

- **Git stores pointers; LFS stores bytes.** A correct git clone is not a complete
  product checkout for LFS repos.
- **`git lfs install` is per-user (or per-repo), not automatic on clone.** Images
  and runners need it in the setup.
- **Pointer committed without `git lfs track`** is how binaries get into git
  *anyway* — huge repos. `git lfs migrate` if you already did that.
- **Missing LFS objects are a shipping bug**, not a "refresh the CDN" bug. Check
  `git lfs pull` before blaming nginx.
