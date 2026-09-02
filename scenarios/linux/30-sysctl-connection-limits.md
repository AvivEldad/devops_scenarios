# Connections dropped under load with plenty of resources free

## Briefing

Under heavy traffic a server starts dropping or refusing connections, and requests time out —
yet CPU, memory, disk, and file descriptors all have headroom. The limits being hit are
kernel tunables (sysctls) sized for a quiet machine, not for production load.

Several kernel-level ceilings can throttle a busy host: the listen backlog / SYN queue, the
conntrack table (on any box doing NAT or stateful firewalling), and various network buffers.
None of them show up as CPU or memory; they surface as dropped SYNs, `nf_conntrack: table
full` in the log, and connection resets.

## Your Task

- Reproduce (or read the evidence of) connections dropped due to a kernel limit, not resource
  exhaustion.
- Identify which ceiling is being hit (backlog, conntrack, or buffers).
- Raise the right sysctl(s) durably and understand the trade-offs.

## Starter Files

### file: notes.md

```text
Symptoms under load:
  - clients see connection timeouts / resets; server CPU and RAM are fine
  - dmesg: "nf_conntrack: table full, dropping packet"
  - ss -s shows many SYN-RECV; some SYNs never complete the handshake
  - netstat -s shows "SYNs to LISTEN sockets dropped" / "times the listen queue overflowed"

Suspect kernel limits sized for an idle box:
  net.core.somaxconn                (listen backlog cap)
  net.ipv4.tcp_max_syn_backlog      (half-open/SYN queue)
  net.netfilter.nf_conntrack_max    (tracked connections, if NAT/firewall in path)
  net.core.rmem_max / wmem_max      (socket buffer ceilings)
```

## Expected Failure

```bash
# backlog overflow: accept queue full, SYNs dropped
netstat -s | grep -iE 'listen|overflow'
# NNN times the listen queue of a socket overflowed
# NNN SYNs to LISTEN sockets dropped

ss -ltn
# State   Recv-Q  Send-Q  Local Address:Port
# LISTEN  129     128     0.0.0.0:8080        <- Recv-Q > Send-Q(backlog) = overflowing
```

```bash
# conntrack table full (on a NAT/firewall box):
dmesg -T | grep -i conntrack
# nf_conntrack: table full, dropping packet
cat /proc/sys/net/netfilter/nf_conntrack_max
# 65536
cat /proc/sys/net/netfilter/nf_conntrack_count
# 65536                        <- at the ceiling: every new connection is dropped
```

The host is not out of CPU or RAM. It is hitting kernel ceilings: the listen accept queue is
overflowing (SYNs dropped), and/or the conntrack table is full so new connections are dropped
at the netfilter layer. These are configuration limits, invisible to resource monitoring.

## Expected Outcome

The server sustains the load without kernel-level drops.

Backlog overflows stop and the accept queue keeps up:

```bash
netstat -s | grep -iE 'listen|overflow'    # counters stop increasing
ss -ltn                                     # Recv-Q stays well below Send-Q(backlog)
```

Conntrack has headroom (if in the path):

```bash
awk 'END{print}' /dev/null; cat /proc/sys/net/netfilter/nf_conntrack_count \
  /proc/sys/net/netfilter/nf_conntrack_max
# count comfortably below max; no "table full" in dmesg
```

The tunables are set durably:

```bash
sysctl net.core.somaxconn net.netfilter.nf_conntrack_max
# values raised, and persisted in /etc/sysctl.d/*.conf
```

## Hints

### Hint 1 — These drops are in counters, not in top

Resource monitors look fine because the limit is a kernel table/queue. Read the network
counters instead: `netstat -s` (listen queue overflows, SYN drops, buffer prune),
`ss -s`/`ss -ltn` (SYN-RECV, Recv-Q vs Send-Q), and `dmesg`/`journalctl -k` for
`nf_conntrack: table full`. Match the symptom to the specific ceiling before tuning.

### Hint 2 — Raise the matching sysctl, and the app's backlog

- Accept-queue overflow: raise `net.core.somaxconn` AND have the app pass a matching
  `listen()` backlog (many default to 128); also `net.ipv4.tcp_max_syn_backlog` for the
  half-open queue.
- Conntrack full: raise `net.netfilter.nf_conntrack_max` (and hashsize), and/or reduce
  timeouts / add `NOTRACK` rules for traffic that need not be tracked. Only relevant where
  netfilter conntrack is loaded.
- Throughput on high-latency links: raise `net.core.rmem_max`/`wmem_max`.
Persist everything in `/etc/sysctl.d/*.conf` and apply with `sysctl --system`.

## Solution

Identify the ceiling from the counters, raise the matching sysctl (and the app backlog), and
persist it.

```bash
# 1) diagnose which limit
netstat -s | grep -iE 'listen|overflow|syn'      # accept/SYN queue drops
ss -ltn                                          # Recv-Q vs Send-Q per listener
dmesg -T | grep -i conntrack                     # conntrack table full?
cat /proc/sys/net/netfilter/nf_conntrack_{count,max} 2>/dev/null

# 2) raise the matching tunables (examples)
sudo tee /etc/sysctl.d/99-tuning.conf >/dev/null <<'EOF'
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
net.netfilter.nf_conntrack_max = 262144
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
EOF
sudo sysctl --system

# 3) make the APP use the larger backlog (somaxconn only caps it)
#    e.g. nginx: listen 80 backlog=4096;   or the listen() call in your service

# 4) verify under load
ss -ltn ; netstat -s | grep -iE 'overflow|dropped'
```

- **Kernel ceilings throttle load invisibly to resource monitors.** Dropped SYNs, overflowed
  accept queues, and a full conntrack table have nothing to do with CPU/RAM/fds — read the
  network counters (`netstat -s`, `ss`, `dmesg`) to find them.
- **`somaxconn` caps the accept queue, but the app sets the actual backlog.** Raising the
  sysctl alone does nothing if the service still calls `listen(fd, 128)` — configure both (e.g.
  nginx `backlog=`). `tcp_max_syn_backlog` covers the half-open queue.
- **conntrack fills on any NAT/stateful-firewall box.** `nf_conntrack: table full` drops new
  connections at the netfilter layer; raise `nf_conntrack_max` (and hashsize), trim timeouts, or
  `NOTRACK` traffic that needs no tracking. Irrelevant if conntrack is not loaded.
- **Persist in `/etc/sysctl.d/` and apply with `sysctl --system`.** Values set with `sysctl -w`
  vanish on reboot; production tuning must survive restarts.
- **Tune to evidence, not superstition.** Raise the specific ceiling the counters show you are
  hitting; blindly inflating every buffer wastes memory and can hide the real bottleneck.
