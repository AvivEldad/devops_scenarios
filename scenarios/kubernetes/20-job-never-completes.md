# The job that runs forever and never completes

## Briefing

A `Job` was supposed to run a batch task once and finish. Instead it spawns pod after pod,
never reaching `Completions`, and the cluster fills with `Error`/`CrashLoopBackOff`
attempts. A CronJob variant piles up missed runs or overlapping runs.

The Job's container exits non-zero (a bug in the task), and with default `backoffLimit` and
`restartPolicy` the Job keeps retrying. Compounding it, no `activeDeadlineSeconds` bounds
the runtime, and a CronJob with the wrong `concurrencyPolicy` overlaps runs.

## Your Task

- Apply the Job and watch it retry endlessly instead of completing.
- Explain how `backoffLimit`, `restartPolicy`, and deadlines govern Job behaviour.
- Make the Job either succeed or fail cleanly and stop, and make a CronJob variant safe.

## Starter Files

### file: job.yaml

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
  namespace: default
spec:
  # no backoffLimit -> defaults to 6, but the task always fails,
  # and no activeDeadlineSeconds -> nothing bounds total runtime
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: busybox:1.36
          command: ["sh", "-c", "echo migrating...; exit 1"]   # always fails
```

### file: cron.yaml

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: report
  namespace: default
spec:
  schedule: "* * * * *"          # every minute
  # no concurrencyPolicy -> Allow: slow runs overlap and stack up
  # no startingDeadlineSeconds, no history limits
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: report
              image: busybox:1.36
              command: ["sh", "-c", "sleep 120; echo done"]  # takes 2m, runs every 1m
```

## Expected Failure

```bash
kubectl apply -f job.yaml
kubectl get pods -l job-name=migrate
# migrate-aaaaa   0/1   Error   0   40s
# migrate-bbbbb   0/1   Error   0   30s
# migrate-ccccc   0/1   Error   0   20s      <- retrying up to backoffLimit

kubectl get job migrate
# NAME      COMPLETIONS   DURATION   AGE
# migrate   0/1           60s        60s      <- never completes
```

```bash
kubectl apply -f cron.yaml   # each run takes 2m but fires every 1m
kubectl get pods -l job-name --sort-by=.metadata.creationTimestamp
# overlapping report-* pods stacking on top of each other
```

The Job's command always exits 1, so it retries up to `backoffLimit` (default 6) and then
gives up as `Failed` — but until then it churns. The CronJob's task outlasts its interval
and, with `concurrencyPolicy: Allow`, overlapping runs pile up.

## Expected Outcome

The Job completes (or fails fast and stops), and the CronJob does not overlap.

A fixed Job reaches completion:

```bash
kubectl get job migrate
# migrate   1/1   5s   1m
```

Or, if it must fail, it stops promptly with a bounded backoff and a deadline:

```bash
kubectl describe job migrate | grep -i -E 'backoffLimit|deadline|Failed'
```

The CronJob does not overlap and bounds history:

```bash
kubectl get cronjob report -o jsonpath='{.spec.concurrencyPolicy}{"\n"}'
# Forbid   (or Replace)
```

## Hints

### Hint 1 — backoffLimit + restartPolicy bound retries

With `restartPolicy: Never`, each failed attempt is a new pod, retried up to `backoffLimit`
(default 6) before the Job is marked `Failed`. Lower `backoffLimit` to fail fast, and add
`activeDeadlineSeconds` to cap total runtime so a hung task cannot run forever. Fix the
underlying command so it can actually succeed.

### Hint 2 — CronJobs need a concurrency policy

`concurrencyPolicy: Forbid` skips a run if the previous one is still going; `Replace` kills
the old run and starts fresh; `Allow` (default) lets them overlap. Pick `Forbid` or `Replace`
for tasks that can outlast their interval. Set `startingDeadlineSeconds` and
`successfulJobsHistoryLimit`/`failedJobsHistoryLimit` to control missed-run handling and
history buildup.

## Solution

Fix the Job's command so it can succeed, bound retries and runtime, and give the CronJob a
concurrency policy and history limits.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
  namespace: default
spec:
  backoffLimit: 2                 # fail fast instead of churning
  activeDeadlineSeconds: 300      # hard cap on total runtime
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: busybox:1.36
          command: ["sh", "-c", "echo migrating...; exit 0"]   # real task, can succeed
```

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: report
  namespace: default
spec:
  schedule: "* * * * *"
  concurrencyPolicy: Forbid         # do not overlap
  startingDeadlineSeconds: 30
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 90
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: report
              image: busybox:1.36
              command: ["sh", "-c", "echo quick report; echo done"]
```

- **A Job retries a failing container up to `backoffLimit`** (default 6) before it is
  `Failed`. If the command can never succeed, it churns through attempts — fix the command;
  lower the limit to fail fast.
- **`restartPolicy` must be `Never` or `OnFailure`** for Jobs (`Always` is invalid). `Never`
  makes each retry a fresh pod (easier to inspect); `OnFailure` restarts in place.
- **`activeDeadlineSeconds` caps total runtime**, turning a hung Job into a clean failure
  instead of an eternal one. Use it for anything that could stall.
- **CronJobs default to `concurrencyPolicy: Allow`**, so a task that runs longer than its
  interval overlaps and stacks. Use `Forbid` (skip) or `Replace` (supersede) for such tasks.
- **Bound CronJob history** with `successful/failedJobsHistoryLimit`, and set
  `startingDeadlineSeconds` so a briefly-down scheduler does not later fire a burst of missed
  runs at once.
