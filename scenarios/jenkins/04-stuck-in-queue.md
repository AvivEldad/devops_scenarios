# The build that sits in the queue forever

## Briefing

You trigger a job and it never starts. The build queue shows it as pending with the
message `waiting for next available executor (label 'linux-arm')`. There are idle
agents right there in the node list.

The job is asking for a capability no agent advertises. Jenkins will wait for it
politely and indefinitely.

## Your Task

- Configure the job with the given label expression and trigger it.
- Read why it is stuck rather than assuming the agents are down.
- Make it run on an available agent without removing all label constraints.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent { label 'linux-arm && gpu' }

    stages {
        stage('Build') {
            steps {
                sh 'echo building on $(hostname)'
            }
        }
    }
}
```

### file: notes.md

```text
Available agents and their labels:
  agent-1   ->  linux amd64 docker
  agent-2   ->  linux amd64 docker
  controller -> built-in (no build label)

No agent has 'linux-arm' or 'gpu'.
```

## Expected Failure

Trigger the build and open the queue:

```
(pending) waiting for next available executor
Job is waiting because there are no online nodes with the label 'linux-arm && gpu'
```

The agents are online and idle. Nothing runs, no error is thrown, and the build waits
for a node that does not exist.

## Expected Outcome

The job runs on an available agent.

The build starts and completes:

```
Started by user ...
Running on agent-1 in /home/jenkins/workspace/demo
+ echo building on agent-1
Finished: SUCCESS
```

The label expression matches at least one real agent:

```
# the agent it ran on satisfies the label
Running on agent-1
```

And it is still constrained — it must not run on the controller's built-in node:

```
# the job should target build agents, not the controller
```

## Hints

### Hint 1 — The label is an unsatisfiable requirement

`agent { label 'linux-arm && gpu' }` means "only on a node labelled both `linux-arm`
and `gpu`". No such node exists, so the job queues forever. Jenkins does not treat this
as an error — an agent with those labels could come online later.

Check what labels exist under **Manage Jenkins → Nodes**, or click the queued item; the
tooltip states exactly which label went unmatched.

### Hint 2 — Match a label your agents actually advertise

```groovy
agent { label 'linux && amd64' }
```

Use `&&`, `||` and `!` to combine labels. Keep the expression as specific as the job
genuinely needs and no more — over-constraining is exactly what caused this.

## Solution

The label expression required capabilities no agent had.

```groovy
pipeline {
    agent { label 'linux && docker' }

    stages {
        stage('Build') {
            steps {
                sh 'echo building on $(hostname)'
            }
        }
    }
}
```

- **A queued build with "no online nodes with label X" is a label mismatch, not an
  outage.** The agents are fine; the request cannot be satisfied. Read the queue reason
  before restarting anything.
- **Labels are capabilities, not names.** Label agents by what they provide (`docker`,
  `amd64`, `gpu`) and request the intersection a job needs. This lets Jenkins schedule
  freely across a pool.
- **`agent none` at the top with per-stage agents** is the pattern when different stages
  need different capabilities — build on `docker`, test on `gpu`, and each stage waits
  only for what it needs.
- **Keep builds off the controller.** The built-in node should have zero executors in
  production, so agent labels are the only place work can land — which also prevents a
  runaway build from touching Jenkins' own filesystem.
