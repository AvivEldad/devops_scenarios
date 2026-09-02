# upload-artifact says no files found

## Briefing

`actions/upload-artifact` fails: `No files were found with the provided path`
or the download is empty. The path is `./dist` but the build wrote
`build/dist`, or the file is in another job's workspace (workspaces are
**per job**, even on the same runner label), or you globbed `*.xml` from the
wrong cwd. `if-no-files-found: error` is the right default; `warn` hides it.

This is the Actions analogue of Jenkins `archiveArtifacts` missing files.

## Your Task

- Fail an upload with a wrong path.
- `ls` the workspace before upload.
- Pass files between jobs with upload/download, not by assuming a shared disk.

## Starter Files

### file: .github/workflows/build.yml

```yaml
name: build
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: mkdir -p build && echo ok > build/app.bin
      - uses: actions/upload-artifact@v4
        with:
          name: app
          path: dist/**
  package:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: ls -la dist
```

## Expected Failure

```text
build: No files were found with the provided path: dist/**
package: ls: cannot access 'dist': No such file or directory
```

The binary is at `build/app.bin`. Job `package` is a **new** VM; even a
correct upload was never downloaded.

## Expected Outcome

Artifact contains `app.bin`; the second job downloads it.

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: app
    path: build/app.bin
    if-no-files-found: error
# package:
- uses: actions/download-artifact@v4
  with:
    name: app
    path: dist
- run: ls -la dist
```

## Hints

### Hint 1 — Path is the job workspace

`actions/checkout` puts the repo in `$GITHUB_WORKSPACE`. Relative paths are
from there. `working-directory:` on a step does not change upload-artifact's
`path` unless you `cd` in a `run` that creates files there.

### Hint 2 — v4 artifacts are per-job immutable

`upload-artifact@v4` cannot append in a later step the same way v3 could.
One upload per name per job. Matrix: unique `name: app-${{ matrix.os }}`.

## Solution

Upload the real path; download in the next job.

```yaml
- run: ls -R build
- uses: actions/upload-artifact@v4
  with:
    name: app
    path: build/app.bin
```

- **`retention-days`** defaults to 90 or org settings; expired artifacts
  "vanish" from old runs.
- **`include-hidden-files`** (v4) if you need `.coverage`.
- **Huge artifacts** fail or evict caches — expert drill later.
- **Never upload secrets** (.env, credentials). Artifacts are downloadable
  by anyone with repo read (and sometimes via the UI longer than you think).
