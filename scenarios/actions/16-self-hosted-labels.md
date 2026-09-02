# The self-hosted runner job sat queued forever

## Briefing

`runs-on: [self-hosted, linux, gpu]` and the job never starts. Hosted
`ubuntu-latest` jobs run fine. Labels must **all** match a runner. You tagged
the machine `gpu` in your head but the runner only has `self-hosted` and
`linux`. Offline runners still match labels and starve the queue. This is the
same idea as Jenkins "waiting for executor" with labels.

## Your Task

- List runner labels in the repo settings (or from the job "Queued" tooltip).
- Reduce `runs-on` to labels that exist, or add the missing label to the
  runner.
- Handle offline runners (remove / drain).

## Starter Files

### file: .github/workflows/train.yml

```yaml
name: train
on: workflow_dispatch
jobs:
  train:
    runs-on: [self-hosted, linux, gpu, cuda12]
    steps:
      - run: nvidia-smi
```

## Expected Failure

```text
Requested labels: self-hosted, linux, gpu, cuda12
Job queued for 45 minutes
No runner available
```

The box is online as `self-hosted,linux,x64`. No `gpu` label.

## Expected Outcome

The job is picked up by a live runner.

```yaml
runs-on: [self-hosted, linux, gpu]
```

and the runner config has those labels; **or** you add `cuda12` to the
runner, not the job, consistently.

`nvidia-smi` prints GPU info.

## Hints

### Hint 1 — AND not OR

`runs-on: [a, b, c]` means a runner that has a **and** b **and** c. Extra
labels on the runner are fine. Missing one is queue forever.

### Hint 2 — ubuntu-latest is not self-hosted

Mixing `runs-on: ubuntu-latest` in other jobs is GitHub-hosted. Self-hosted
never sees them. A job with `runs-on: linux` (no `self-hosted`) may match
hosted *or* self-hosted depending on GitHub's rules — prefer explicit
`self-hosted` + OS.

## Solution

Align labels; check Settings → Actions → Runners (green = idle, idle needed).

```yaml
runs-on: [self-hosted, linux]
```

until GPU labels exist.

- **Ephemeral runners** (scale-to-zero) show queued until a new VM registers.
  Autoscaling delay looks like this bug.
- **`runs-on: "${{ inputs.runner }}"`** typos are common. Print the value.
- **Security:** self-hosted in a public repo is dangerous (fork PRs). GitHub
  blocks some of this; still do not attach privileged runners to public forks.
- **`timeout-minutes`** on the job still counts queued time in some views —
  set `queue` expectations in the runbook.
