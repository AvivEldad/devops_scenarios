# The agent that keeps going offline

## Briefing

A build agent drops offline several times a day with `Connection was broken` or
`Ping response time is too long`. Builds on it fail mid-run. It comes back on its own,
so nobody has fixed it, but the flakiness is now a tax on every build that lands there.

The agent is running out of memory and being partly killed, its clock has drifted, and
the ping timeout is too aggressive for the network between it and the controller. Three
contributing causes.

## Your Task

- Read the agent and controller logs around a disconnect.
- Identify the resource and configuration causes rather than just restarting it.
- Make the agent stable, and make builds resilient to a transient disconnect.

## Starter Files

### file: symptoms.md

```text
Controller log:
  Ping response time is too long or timed out. Restarting agent
  Agent 'builder-3' disconnected: java.io.IOException: Connection reset

Agent log (agent.jar):
  java.lang.OutOfMemoryError: Java heap space
  <long GC pauses>

On the agent host:
  $ dmesg | tail
  Out of memory: Killed process 2143 (java)
  $ timedatectl
  System clock synchronized: no
  Time zone: UTC; NTP service: inactive
```

### file: Jenkinsfile

```groovy
pipeline {
    agent { label 'builder-3' }
    stages {
        stage('Build') {
            steps {
                sh 'echo building'
            }
        }
    }
}
```

## Expected Failure

Mid-build, the agent vanishes:

```
Ping response time is too long or timed out. Restarting agent
Cannot contact builder-3: java.io.IOException: Connection reset
ERROR: Agent went offline during the build
Finished: FAILURE
```

The agent JVM was OOM-killed, GC pauses exceeded the ping timeout, and the drifted clock
compounds TLS and log-correlation problems. Restarting the agent clears it until next
time.

## Expected Outcome

The agent stays connected under load, and a blip does not automatically fail a build.

The agent's JVM has adequate heap and does not OOM:

```
# agent.jar started with a sane -Xmx; no OutOfMemoryError in the agent log
```

Time is synchronised:

```bash
timedatectl
# System clock synchronized: yes ; NTP service: active
```

The ping timeout tolerates normal GC pauses (raised, or responsiveness check tuned), and
the agent no longer flaps:

```
# hours of builds with no "Ping response time too long" disconnects
```

Builds tolerate a brief disconnect where reasonable, and executors are sized so the agent
is not overcommitted:

```
# number of executors <= CPU/memory the host can actually sustain
```

## Hints

### Hint 1 — Separate the causes from the logs

- `OutOfMemoryError` + `dmesg` OOM kill → the agent JVM (or build processes) exceed host
  memory. Reduce executors, raise limits, or move heavy builds to bigger agents.
- `Ping response time is too long` → the controller's agent-responsiveness check timed
  out, often *because* of long GC pauses or a saturated host, not a real network fault.
- `clock synchronized: no` → enable NTP; drift causes TLS and correlation problems and is
  cheap to fix.

### Hint 2 — Size executors and heap to the host

Executors × per-build footprint must fit in the host's CPU and RAM. An agent with 4 GB
and 8 executors will thrash and OOM. Set executors conservatively, give `agent.jar` a
reasonable `-Xmx`, and run heavy builds in containers with their own limits so one build
cannot starve the agent process.

## Solution

Three causes: memory overcommit, GC-induced ping timeouts, and clock drift.

Fix the host and agent configuration:

```bash
# synchronise time
sudo timedatectl set-ntp true

# ensure the agent JVM has enough heap (in the agent service / launch args)
# e.g. java -Xmx1g -jar agent.jar ...

# reduce the number of executors to what the host can sustain
#   Manage Jenkins -> Nodes -> builder-3 -> # of executors
```

Make the build resilient and keep it off an overcommitted node:

```groovy
pipeline {
    agent { label 'builder' }   // a pool, not one fragile named node

    options {
        timeout(time: 30, unit: 'MINUTES')
        retry(1)                // one retry absorbs a single transient blip
    }

    stages {
        stage('Build') {
            steps {
                sh 'echo building'
            }
        }
    }
}
```

- **Agent disconnects are usually resource problems wearing a network costume.** "Ping
  response time too long" most often means the agent JVM was in a long GC pause or the host
  was saturated — investigate memory and executor count before blaming the network.
- **Size executors to the host.** Overcommitting CPU and RAM causes thrashing, OOM kills,
  and the flapping this scenario shows. Fewer, well-fed executors beat many starving ones.
- **Run NTP.** Clock drift breaks TLS handshakes, log correlation and token validity, and
  is trivial to fix — there is no reason to leave it off.
- **Target a label pool, not a single named node.** Pinning to `builder-3` concentrates
  risk on one fragile machine; a pool lets Jenkins route around a sick agent.
- **Prefer ephemeral agents** (Kubernetes or cloud plugins) where you can — a fresh agent
  per build eliminates accumulated state and the "restart fixes it" cycle entirely.
