# High load average while the CPUs sit idle

## Briefing

The load average is 20 on an 8-core box and everything is slow, but `top` shows the CPUs are
mostly *idle*. This looks like a contradiction until you know what load average actually
measures. The system is not CPU-bound — it is blocked on something else.

Linux load average counts processes that are runnable **or** in uninterruptible sleep
(`D` state, usually waiting on I/O). A storage problem, a hung NFS mount, or a saturated disk
can pile up `D`-state processes, driving load sky-high while CPU utilisation stays low.

## Your Task

- Observe (or reconstruct) high load with idle CPUs and recognise it as I/O wait, not CPU.
- Identify the processes stuck in `D` state and what they are blocked on.
- Point to the real bottleneck (the storage/mount), not the CPU.

## Starter Files

### file: notes.md

```text
Symptoms:
  $ uptime
    load average: 21.4, 18.9, 12.2      (on an 8-core machine)
  $ top   ->  %Cpu(s):  3.1 us,  1.0 sy,  0.0 ni, 40.0 id, 55.6 wa
                                                   ^^^^ 40% IDLE, 55% I/O WAIT
  Load is high but CPUs are idle. The 'wa' (iowait) is huge.
  Many processes show STAT 'D' (uninterruptible sleep).
```

## Expected Failure

```bash
uptime
# load average: 21.40, 18.90, 12.20      <- very high

top -b -n1 | grep '%Cpu'
# %Cpu(s):  3.1 us,  1.0 sy,  0.0 ni, 40.0 id, 55.6 wa, 0.0 hi, 0.3 si
#                                     ^idle   ^iowait    <- CPUs idle, waiting on I/O
```

```bash
# who is in D state (uninterruptible sleep on I/O)?
ps -eo pid,stat,wchan:20,comm | awk '$2 ~ /D/'
#  PID STAT WCHAN                COMMAND
# 4821 D    wait_on_page_bit     backup
# 4990 D    nfs_wait_on_request  rsync            <- blocked in the NFS client
```

Load average includes `D`-state (uninterruptible) processes, not just those wanting CPU. The
CPUs are idle; the queue is full of processes blocked on I/O (here, disk and a slow NFS
mount). High load + idle CPU + high `wa` = an I/O bottleneck, not a compute problem.

## Expected Outcome

You correctly attribute the slowdown to I/O and identify the source.

I/O wait and the busy device are visible:

```bash
iostat -x 1 3
# Device   ...  %util   await
# sdb      ...  99.8   420.0        <- device saturated, huge latency
```

The blocked processes and their wait channel are named:

```bash
ps -eo pid,stat,wchan:25,comm | awk '$2 ~ /D/'
# processes blocked in disk/NFS wait, not burning CPU
```

Once the storage issue is addressed (or the offending I/O throttled/stopped), load falls back
toward the runnable-process count and `wa` drops.

## Hints

### Hint 1 — Load average is not CPU utilisation

Load average = average number of processes runnable **plus** uninterruptible (`D`). A box can
show load 20 with idle CPUs if 20 processes are all blocked on I/O. Read `top`'s `wa` (iowait)
and `id` (idle): high `wa` with high load and low `us`/`sy` means storage, not compute.

### Hint 2 — Find the D-state processes and the busy device

`ps -eo pid,stat,wchan,comm | awk '$2 ~ /D/'` lists uninterruptible processes and their kernel
wait channel (`nfs_*`, `wait_on_page_bit`, etc.). `iostat -x 1` shows per-device `%util` and
`await` (latency); `iotop` shows per-process I/O. The fix is the storage layer — a failing
disk, a hung/slow NFS server, or an I/O-heavy job to throttle — not adding CPU.

## Solution

Recognise the I/O-bound signature, find the blocked processes and the saturated device, and
address the storage cause.

```bash
# 1) confirm it is I/O, not CPU
uptime
top -b -n1 | grep '%Cpu'                 # high 'wa', high 'id'

# 2) find the blocked processes and their wait channel
ps -eo pid,stat,wchan:25,comm | awk '$2 ~ /D/'

# 3) find the saturated device / heavy writer
iostat -x 1 3                            # look for %util ~100, high await
sudo iotop -o -b -n3 2>/dev/null | head  # per-process I/O

# 4) act on the STORAGE cause:
#    - recover/failover the hung NFS mount (see the nfs_* wchan)
#    - throttle or reschedule the heavy job (ionice -c3 <pid>)
#    - replace the failing disk (check dmesg / smartctl)
```

- **Load average measures the run queue plus uninterruptible sleepers, not CPU busyness.**
  High load with idle CPUs is the classic sign of an I/O bottleneck — adding cores does nothing.
- **`top`'s `wa` (iowait) is the tell.** High `wa` + high `id` + low `us`/`sy` says processes
  are waiting on storage. Read the CPU breakdown, not just the load number.
- **`D` state = uninterruptible sleep**, almost always disk or network filesystem I/O. Those
  processes cannot even be killed until the I/O completes, and each one adds to load. The
  `wchan` names what they wait on.
- **Locate the source with `iostat -x` and `iotop`.** Per-device `%util`/`await` finds the
  saturated or failing disk; per-process I/O finds the heavy writer. Hung NFS shows up as `nfs_*`
  wait channels.
- **The fix is at the storage layer** — recover the mount, throttle the job (`ionice`), or
  replace the dying disk. Treating high load as "need more CPU" wastes money and fixes nothing.
