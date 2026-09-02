# The allow rule is in the list and the packet still dies

## Briefing

`iptables -L INPUT` shows `ACCEPT tcp dpt:443` near the bottom. The change
ticket is green. Curl still times out. Higher in the chain is `-j DROP` for
the same source, or a blanket `REJECT` that was inserted with `-I INPUT 1`
during an incident last year.

iptables and nftables are first-match. A rule that exists is not a rule that
fires. Counters tell you which line actually saw the packet.

## Your Task

- List the chain with line numbers and packet counters.
- Identify the rule that matches first for the real source and port.
- Reorder or delete so the ACCEPT is reachable, then confirm curl.

## Starter Files

### file: rules.broken

```
# iptables -L INPUT -n -v --line-numbers  (simplified)
# num  pkts  target  proto  source       extra
# 1    9001  DROP    all    10.4.0.0/16
# 2       0  ACCEPT  tcp    0.0.0.0/0    dpt:443
# 3     120  ACCEPT  all    127.0.0.1
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "Always list with counters and line numbers:"
echo "  sudo iptables -L INPUT -n -v --line-numbers"
echo "  sudo nft list chain inet filter input"
echo
echo "A later ACCEPT never runs if an earlier DROP matched."
```

## Expected Failure

```bash
sudo iptables -L INPUT -n -v --line-numbers
# 1  9001  DROP    ...  10.4.0.0/16
# 2     0  ACCEPT  ...  dpt:443          <- zero packets: it never matched

curl -sv --connect-timeout 3 https://<this-host>/
# Connection timed out
```

The ACCEPT you added is dead code.

## Expected Outcome

```bash
sudo iptables -L INPUT -n -v --line-numbers
# ACCEPT for tcp/443 is above any DROP for that source
# its packet counter increases when you curl

curl -sS --connect-timeout 3 -o /dev/null -w "%{http_code}\n" https://<this-host>/
# 200
```

## Hints

### Hint 1 — Counters are the truth

Zero packets on your new ACCEPT means a previous rule ate the traffic. Watch
counters increment while you reproduce: `watch -n1 iptables -L INPUT -n -v`.

### Hint 2 — -I vs -A

`-A` appends (often after a DROP). `-I INPUT 1` inserts at the top (often by
accident during an incident). Use `--line-numbers` and `-R`/`-D` to put the
allow where it can fire. nftables `insert rule ... index N` is the same idea.

## Solution

Make the first match the one you meant.

```bash
sudo iptables -L INPUT -n -v --line-numbers
sudo iptables -D INPUT 1          # the stale DROP, if that is wrong
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
# nft:
# nft insert rule inet filter input position <handle> tcp dport 443 accept
```

- **First match wins.** Listing "an ACCEPT exists" is not a diagnosis.
- **Counters** tell you which line is alive.
- **`-A` after a DROP is a no-op** for that traffic.
- **Save the table** (`iptables-save`, nft, firewalld) or the next reload
  restores the old order.
