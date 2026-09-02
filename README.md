# BreakFix Lab

A local, offline collection of DevOps scenarios that are **broken on purpose**.

You get a task and files that look reasonable. They are not. You follow the
instructions, the thing fails the way real systems fail, and you debug it back to a
stated expected outcome. Hints and solutions are hidden until you ask for them.

There is no "build a cluster from scratch" exercise here. Every scenario hands you
something that already exists and has already gone wrong, which is what the job
actually looks like.

## Run it

```bash
cd /devops-scenarios
python3 -m http.server 8080
```

Open <http://localhost:8080>.

Any static server works. The site has no build step, no dependencies and no network
calls — but it does need to be served over HTTP, because the browser blocks
`fetch()` on `file://` URLs.

```bash
# alternatives
npx serve -l 8080
php -S localhost:8080
```

Your progress (which scenarios you marked solved) is stored in the browser's
`localStorage`. Nothing leaves your machine.

## The loop

```
read the task  ->  run it  ->  it breaks  ->  investigate  ->  fix  ->  match expected outcome
```

Every scenario page has the same six sections:

| Section | Purpose |
|---|---|
| Briefing | The situation, written as a colleague would hand it to you |
| Your task | What you must achieve, and what you may not change |
| Starter files | The broken artefacts, with a copy button |
| What failure looks like | The exact output you should see, so you know you reproduced it |
| Expected outcome | Commands and output that prove you fixed it — this is your self-check |
| Hints, then Solution | Progressive, collapsed by default |

Verification is **self-check**: you run the commands listed under *Expected outcome*
and compare. There is no grader, and nothing on the page can tell whether you cheated
— which is rather the point.

## What is covered

24 scenarios, 8 topics, 3 difficulty levels each.

| Topic | Beginner | Intermediate | Expert |
|---|---|---|---|
| **Docker** | Container exits instantly | Port mapped but unreachable | 900 MB root image, no layer caching |
| **Kubernetes** | CrashLoopBackOff | Service with no endpoints | Rollout stuck, three faults |
| **Git** | Committed secret, useless .gitignore | Merge conflict in a pipeline file | Recover commits after a hard reset |
| **Linux** | Permission denied, three causes | Port in use, invisible process | Cron job that silently does nothing |
| **Python** | KeyError instead of a usable error | ModuleNotFoundError in CI | Wrapper that reports success after failing |
| **Bash** | Unquoted variable destroys the wrong path | Exit 0 on a failed pipeline | Leaked lock file wedges every later run |
| **Terraform** | Four errors across init/validate/plan | count vs for_each, state migration | Drift, rename and import reconciliation |
| **AWS** | S3 AccessDenied on your own bucket | EC2 unreachable at three layers | CI cannot assume the deploy role |

Difficulty means how much the scenario tells you, not how obscure the technology is:

- **Beginner** — one clear fault, the task names the subsystem
- **Intermediate** — two faults, or one that hides behind a misleading symptom
- **Expert** — three or more faults that mask each other, so fixing one changes the
  failure rather than removing it

## Prerequisites are yours

Nothing here installs, provisions or bills anything. Each scenario lists what it
needs, and you bring it.

| Topic | You need |
|---|---|
| Docker | Docker (the expert scenario needs network access for `pip`) |
| Kubernetes | Any cluster you can create a namespace in — kind, k3d, minikube, Docker Desktop |
| Git, Bash, Linux, Python | A Linux or macOS shell |
| Terraform | The `terraform` binary. These use only the `local` and `random` providers, so no cloud account and no cost |
| AWS | **Your own account.** Use a sandbox, never production |

### About the AWS scenarios

They create real resources in whatever account your CLI is pointed at. Each one ships
a `setup.sh` and a `teardown.sh`, and the teardown is part of the exercise.

Before running any of them:

```bash
aws sts get-caller-identity     # confirm which account you are about to touch
```

The EC2 scenario runs a `t3.micro` and may allocate an Elastic IP. Unattached Elastic
IPs are billed, so run the teardown even if you abandon the scenario halfway.

## Working directory convention

Scenarios ask you to work in a scratch directory so nothing touches your real
projects:

```
~/breakfix/<topic>-<number>/
```

Delete it whenever you like. Nothing in the lab depends on state you keep.

## Repository layout

```
devops-scenarios/
├── index.html              catalog with topic and level filters
├── scenario.html           scenario viewer
├── assets/
│   ├── style.css
│   ├── markdown.js         small dependency-free markdown renderer
│   └── app.js              catalog, viewer, progress tracking
├── data/
│   └── scenarios.json      the catalog: id, topic, level, title, prereqs, path
└── scenarios/
    ├── docker/  kubernetes/  git/  linux/
    └── python/  bash/  terraform/  aws/
```

## Adding a scenario

1. Create `scenarios/<topic>/<nn>-<slug>.md`.
2. Add an entry to `data/scenarios.json`.
3. Run `python3 verify.py` to check the catalog and the section structure.
4. Reload the page. There is nothing to rebuild.

The markdown format is parsed by section heading:

~~~markdown
# Title

## Briefing
Why this situation exists, in the voice of a colleague handing it over.

## Your Task
Numbered steps. State explicitly what may not be changed.

## Starter Files
### file: path/to/file
```lang
the broken content
```

## Expected Failure
The exact output the user should see, so they know they reproduced it.

## Expected Outcome
Commands plus expected output. This is the self-check, so be specific.

## Hints
### Hint 1 — short label
### Hint 2 — short label

## Solution
The fix, and the reasoning behind each part of it.

## What You Learned
The transferable lesson, not a summary of the steps.
~~~

`### file:` blocks are only turned into copyable file cards inside the
**Starter Files** section. Elsewhere they are ordinary headings, so use a normal
title like `### The corrected main.tf` in a solution.

Section headings are matched case-insensitively. `Expected Failure` also accepts
`What You Should See`; `Expected Outcome` also accepts `Definition of Done`.

Two rules keep the collection useful:

- **Brownfield only.** The user must be given something that already exists and is
  already wrong. An exercise that starts from an empty directory belongs somewhere
  else.
- **The expected outcome must be checkable.** "It should work now" is not an outcome.
  Give the command and the output.
