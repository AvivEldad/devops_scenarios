# The matrix build that runs one combination

## Briefing

A pipeline is meant to test across three Python versions and two operating systems — six
combinations. It runs exactly one, and the version it tests is always the same. The team
copied the config from a working example and changed the values.

The matrix axes are declared in a way that produces a single cell, and the per-cell
variable is not being read correctly.

## Your Task

- Run the pipeline and confirm only one combination executes.
- Determine why the matrix collapses to a single cell.
- Make it fan out to all six combinations, each using its own axis values.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    stages {
        stage('Test') {
            matrix {
                // axes with a single value each -> one cell
                axes {
                    axis {
                        name 'PY_VERSION'
                        values '3.11'
                    }
                    axis {
                        name 'OS'
                        values 'linux'
                    }
                }
                stages {
                    stage('run') {
                        steps {
                            // reads a hardcoded version, not the axis value
                            sh 'echo "testing python 3.11 on linux"'
                        }
                    }
                }
            }
        }
    }
}
```

## Expected Failure

```
[Matrix - PY_VERSION = '3.11', OS = 'linux']
+ echo "testing python 3.11 on linux"
```

One cell, and the step ignores the axis values anyway — it echoes hardcoded text. The
intended 3×2 fan-out never happens.

## Expected Outcome

All six combinations run, each using its own values.

```
[Matrix - PY_VERSION = '3.10', OS = 'linux']    testing python 3.10 on linux
[Matrix - PY_VERSION = '3.10', OS = 'macos']    testing python 3.10 on macos
[Matrix - PY_VERSION = '3.11', OS = 'linux']    testing python 3.11 on linux
[Matrix - PY_VERSION = '3.11', OS = 'macos']    testing python 3.11 on macos
[Matrix - PY_VERSION = '3.12', OS = 'linux']    testing python 3.12 on linux
[Matrix - PY_VERSION = '3.12', OS = 'macos']    testing python 3.12 on macos
```

Each cell reads its own axis values via the environment, and the six run in parallel.

## Hints

### Hint 1 — Axes need multiple values to fan out

The matrix produces the Cartesian product of its axes. An axis with one value
contributes one option. Give each axis all its values:

```groovy
axis { name 'PY_VERSION'; values '3.10', '3.11', '3.12' }
axis { name 'OS';         values 'linux', 'macos' }
```

3 × 2 = 6 cells.

### Hint 2 — Axis values are exposed as environment variables

Within a cell, each axis name is an environment variable. Read it rather than hardcoding:

```groovy
sh 'echo "testing python $PY_VERSION on $OS"'
```

Use `excludes {}` to drop invalid combinations, and per-axis `agent`/`when` to route
cells to appropriate nodes.

## Solution

Single-value axes collapsed the matrix, and the step ignored the axis variables.

```groovy
pipeline {
    agent any

    stages {
        stage('Test') {
            matrix {
                axes {
                    axis {
                        name 'PY_VERSION'
                        values '3.10', '3.11', '3.12'
                    }
                    axis {
                        name 'OS'
                        values 'linux', 'macos'
                    }
                }
                stages {
                    stage('run') {
                        steps {
                            sh 'echo "testing python $PY_VERSION on $OS"'
                        }
                    }
                }
            }
        }
    }
}
```

- **A matrix is the Cartesian product of its axes.** Each axis needs all its values;
  a one-value axis yields one option and the fan-out disappears.
- **Axis values are environment variables inside each cell.** Read `$PY_VERSION`, do not
  hardcode — otherwise every cell does the same thing regardless of its coordinates.
- **`excludes {}` prunes combinations** that make no sense (e.g. a version not available on
  one OS), and cells run in parallel by default, so mind shared state as in the parallel
  scenario.
- **Route cells with per-cell `agent`**: `agent { label "$OS" }` sends each cell to a
  matching node, which is the usual reason to use a matrix over hand-written parallel
  branches.
