# The build passes locally and fails only in the pipeline

## Briefing

A test suite is green on every developer's laptop and red in Jenkins, on one specific
test that checks date formatting. Another test is red in Jenkins and green locally
because it depends on test-execution order, which differs between environments.

Neither is a Jenkins bug. The pipeline is a cleaner, more parallel, differently-configured
environment that exposes latent assumptions the local runs never challenged. This scenario
is about the "works on my machine" class in general.

## Your Task

- Run the suite in a Jenkins-like environment and reproduce the two failures.
- Identify the hidden environmental assumptions behind each.
- Fix the tests and the pipeline so results are consistent everywhere.

## Starter Files

### file: test_report.py

```python
import datetime

def format_stamp(ts):
    # uses the machine's local timezone - differs between laptop and CI
    return ts.astimezone().strftime("%Y-%m-%d %H:%M")

def test_stamp():
    ts = datetime.datetime(2026, 1, 1, 12, 0, tzinfo=datetime.timezone.utc)
    # this assertion assumes the machine is in UTC+2
    assert format_stamp(ts) == "2026-01-01 14:00"

# module-level state that later tests rely on being set by earlier ones
CACHE = {}

def test_populate():
    CACHE["key"] = "value"

def test_consume():
    # passes only if test_populate ran first - order-dependent
    assert CACHE["key"] == "value"
```

### file: Jenkinsfile

```groovy
pipeline {
    agent any
    stages {
        stage('Test') {
            steps {
                // no fixed timezone; pytest may randomise or parallelise order
                sh 'pytest -p no:randomly test_report.py'
            }
        }
    }
}
```

## Expected Failure

In Jenkins (agent not in UTC+2, and if tests run in a different order):

```
test_stamp        FAILED   assert '2026-01-01 12:00' == '2026-01-01 14:00'
test_consume      FAILED   KeyError: 'key'   (when run before test_populate)
```

Locally both pass: the laptop happens to be in UTC+2, and the tests happen to run in file
order. The pipeline exposed two assumptions that were true locally by accident.

## Expected Outcome

The suite passes deterministically everywhere.

Timezone is pinned so date formatting is identical in every environment:

```
# TZ set explicitly; test_stamp passes on any agent
```

Tests are independent of execution order:

```
# test_consume passes whether or not test_populate ran first, and under any ordering
```

Running the suite in random order still passes:

```bash
pytest -p randomly test_report.py
# all pass, repeatedly, with different seeds
```

The pipeline environment matches the assumptions the tests actually rely on, and those
assumptions are explicit rather than accidental.

## Hints

### Hint 1 — Pin the environment the tests depend on

The date test depends on timezone. Do not depend on the machine's — set it, or make the
code timezone-explicit:

```groovy
environment { TZ = 'UTC' }
```

and assert against UTC in the test, or format with an explicit zone in the code so the
result never depends on the host.

### Hint 2 — Make each test independent

`test_consume` relied on `test_populate` running first via shared module state. Tests must
set up their own preconditions (a fixture) and not depend on order or on each other:

```python
import pytest

@pytest.fixture
def cache():
    return {"key": "value"}

def test_consume(cache):
    assert cache["key"] == "value"
```

Run with random ordering in CI to catch these before they reach production.

## Solution

Two hidden assumptions — the host timezone and test-execution order — that were true
locally by luck.

```python
import datetime
import pytest


def format_stamp(ts, tz=datetime.timezone.utc):
    # explicit timezone: result no longer depends on the host
    return ts.astimezone(tz).strftime("%Y-%m-%d %H:%M")


def test_stamp():
    ts = datetime.datetime(2026, 1, 1, 12, 0, tzinfo=datetime.timezone.utc)
    assert format_stamp(ts) == "2026-01-01 12:00"


@pytest.fixture
def cache():
    return {"key": "value"}


def test_populate(cache):
    cache["key"] = "value2"
    assert cache["key"] == "value2"


def test_consume(cache):
    # independent: its own fixture provides the precondition
    assert cache["key"] == "value"
```

```groovy
pipeline {
    agent any
    environment {
        TZ = 'UTC'
        PYTHONHASHSEED = '0'
    }
    stages {
        stage('Test') {
            steps {
                // random order surfaces order-dependence before production does
                sh 'pip install pytest pytest-randomly && pytest -p randomly test_report.py'
            }
        }
    }
}
```

- **"Works on my machine" is almost always a hidden environmental dependency.** CI is a
  different, cleaner, often parallel environment that surfaces assumptions your local runs
  satisfied by accident — timezone, locale, ordering, filesystem case, available tools.
- **Make dependencies explicit rather than inherited.** Pin `TZ`, set locale, format dates
  with an explicit zone. If the test needs a condition, the test (or a fixture) should
  establish it, not the machine.
- **Tests must be order-independent.** Shared module state that one test sets and another
  reads is a latent bug that passes until the runner changes order. Fixtures give each test
  its own setup; running with `pytest-randomly` catches the rest.
- **Run CI in the strictest environment you can.** Randomised order, UTC, fresh containers,
  no network — the more the pipeline differs from a comfortable laptop, the more real bugs
  it catches before users do.
- **When CI fails and local passes, suspect the environment first, not Jenkins.** The
  pipeline is usually right and the test is usually making an assumption it never stated.
