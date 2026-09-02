# The pipeline rejected by the script security sandbox

## Briefing

A pipeline that ran on an old Jenkins fails after an upgrade with
`Scripts not permitted to use method ...` and `RejectedAccessException`. The Groovy code
is unchanged. The script security sandbox now blocks method calls it considers unsafe.

The reflexive fix — disabling the sandbox or approving everything — removes a real
security control. There are safer ways to get the same result.

## Your Task

- Run the pipeline and reproduce the rejected-method error.
- Understand what the Groovy sandbox protects against.
- Make the pipeline work without disabling sandboxing wholesale.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any
    stages {
        stage('Process') {
            steps {
                script {
                    // in-pipeline Groovy that touches sandbox-restricted methods
                    def data = readFile('data.json')
                    def parsed = new groovy.json.JsonSlurper().parseText(data)
                    def names = parsed.items.collect { it.name.toUpperCase() }
                    // File I/O via java.io is heavily restricted in the sandbox
                    new File('/tmp/out.txt').text = names.join(',')
                    echo names.join(',')
                }
            }
        }
    }
}
```

### file: data.json

```json
{ "items": [ { "name": "alpha" }, { "name": "beta" } ] }
```

## Expected Failure

```
org.jenkinsci.plugins.scriptsecurity.sandbox.RejectedAccessException:
Scripts not permitted to use new java.io.File java.lang.String
Scripts not permitted to use staticMethod ...JsonSlurper parseText ...
Finished: FAILURE
```

The sandbox intercepts Groovy method calls and rejects ones not on its allow-list.
`new File(...)` and raw `JsonSlurper` usage are common casualties. Approving each via
"In-process Script Approval" works but accumulates a long list of dangerous permissions.

## Expected Outcome

The pipeline works using sandbox-safe pipeline steps.

```
+ ALPHA,BETA
```

No manual approval of dangerous methods is required, and the sandbox stays on:

```
# no entries added to In-process Script Approval for java.io.File etc.
```

The output is written through a pipeline step, not raw Java I/O:

```
# /tmp/out.txt or a workspace file contains ALPHA,BETA, written via writeFile
```

## Hints

### Hint 1 — Prefer pipeline steps over raw Groovy/Java

Many restricted calls have safe pipeline-step equivalents that run outside the sandbox
restriction because they are trusted:

- `new File(x).text` → `writeFile file: x, text: ...` / `readFile x`
- `JsonSlurper` → `readJSON` (Pipeline Utility Steps plugin)
- shelling out → `sh(script:, returnStdout: true)`

Using steps avoids the sandbox rejections entirely and is the intended approach.

### Hint 2 — When you must run Groovy, keep it minimal and safe

`collect`, `join`, `toUpperCase` on plain collections and strings are permitted. It is
the `java.io`, reflection, and some static methods that are blocked. Restructure to use
allowed operations, and reserve script approval for genuinely necessary, reviewed cases —
not as a blanket switch.

## Solution

Raw Java I/O and unsandboxed JSON parsing tripped the sandbox. Use pipeline steps.

```groovy
pipeline {
    agent any
    stages {
        stage('Process') {
            steps {
                script {
                    def parsed = readJSON file: 'data.json'          // Pipeline Utility Steps
                    def names = parsed.items.collect { it.name.toUpperCase() }
                    writeFile file: 'out.txt', text: names.join(',')  // sandbox-safe
                    echo names.join(',')
                }
            }
        }
    }
}
```

- **The Groovy sandbox is a security control, not an obstacle to remove.** It prevents a
  Jenkinsfile — which anyone who can open a PR may edit — from calling arbitrary Java,
  reading the controller's secrets, or executing on the controller. Disabling it turns the
  pipeline into arbitrary code execution on Jenkins.
- **Pipeline steps are the sanctioned escape hatch.** `readFile`/`writeFile`, `readJSON`,
  `sh` and the Pipeline Utility Steps plugin cover most of what people reach into `java.io`
  or reflection to do.
- **In-process Script Approval should be a short, reviewed list**, not a dumping ground.
  Each approved signature is a permission granted to every pipeline; approve narrowly and
  deliberately.
- **Trusted shared libraries run outside the sandbox.** Genuinely privileged logic belongs
  in a reviewed shared library under `src/`, loaded from a trusted source, rather than
  inlined and approved ad hoc in every Jenkinsfile.
