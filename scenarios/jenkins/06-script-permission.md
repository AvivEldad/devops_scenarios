# Permission denied running a script from the repo

## Briefing

A pipeline calls `./build.sh`, which is committed to the repository and runs fine on
your laptop. In Jenkins it fails with `Permission denied`.

The file is there and the contents are correct. The execute bit did not survive, and
there is a second reason a committed script can fail in CI that this scenario also
covers.

## Your Task

- Run the pipeline and reproduce the permission error.
- Determine whether the file is executable in the workspace.
- Make the script run reliably regardless of how git recorded its mode.

## Starter Files

### file: build.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "packaging release"
```

### file: Jenkinsfile

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh './build.sh'
            }
        }
    }
}
```

## Expected Failure

```
+ ./build.sh
/home/jenkins/workspace/demo@tmp/durable-x/script.sh: line 1: ./build.sh: Permission denied
```

The file exists and looks fine:

```
+ ls -l build.sh
-rw-r--r-- 1 jenkins jenkins 61 build.sh      <- no execute bit
```

If the repository was created on a system that did not preserve the execute bit, or the
file was added without `git update-index --chmod=+x`, git stored it as mode `644`.

## Expected Outcome

The script runs.

```
+ bash build.sh
packaging release
```

or, having restored the bit:

```
+ ls -l build.sh
-rwxr-xr-x 1 jenkins jenkins 61 build.sh
+ ./build.sh
packaging release
```

The fix works on a clean checkout, not just after a manual `chmod`:

```
# a fresh workspace checkout runs the script without intervention
```

## Hints

### Hint 1 — Check the mode in the workspace

```groovy
sh 'ls -l build.sh; file build.sh'
```

`-rw-r--r--` means no execute bit. `./build.sh` needs `+x`; without it the kernel
refuses to exec the file.

### Hint 2 — Two robust fixes

Either invoke through the interpreter, which does not require the bit:

```groovy
sh 'bash build.sh'
```

or fix it permanently in git so every checkout is correct:

```bash
git update-index --chmod=+x build.sh
git commit -m "mark build.sh executable"
```

The git fix is better because it makes the repository correct everywhere, not just in
this one pipeline.

## Solution

The execute bit was not stored in git, so the checked-out file was not executable.

Permanent fix, in the repository:

```bash
git update-index --chmod=+x build.sh
git commit -m "mark build.sh executable"
```

Defensive fix, in the pipeline, for scripts you do not control:

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                sh 'bash build.sh'
            }
        }
    }
}
```

- **File modes are stored in git and do not always survive.** Files created on Windows,
  extracted from some archives, or added without the execute bit come through as `644`.
  `git ls-files -s build.sh` shows the recorded mode (`100755` is executable).
- **Invoking via the interpreter (`bash script.sh`) sidesteps the bit entirely**, which
  is the safe default for scripts fetched from elsewhere.
- **Watch for CRLF line endings too.** A script with Windows line endings fails with a
  confusing `bad interpreter: /usr/bin/env bash^M`. A `.gitattributes` enforcing `LF`
  for shell scripts prevents both this and the mode problem.
- **This is not a Jenkins bug.** It is a repository-state problem that Jenkins surfaces
  because CI is often the first clean checkout on a Unix agent.
