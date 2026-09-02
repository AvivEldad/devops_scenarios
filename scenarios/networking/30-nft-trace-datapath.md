# iptables -L is empty, nft list looks fine, packets still vanish

## Briefing

The host migrated to nftables. Someone still debugs with `iptables -L`,
which shows the *iptables-nft compatibility* view or a different table
family. The drop is in `inet filter` with a counter that is climbing, or
in an `ebpf`/`tc` filter, or in Cilium policy that never appears in
iptables. The packet is dropped and the operator is looking at the wrong
plane.

Expert work here is *tracing*: make the kernel tell you which rule (or
which hook) dropped the skb, instead of staring at a dump that is not
the live policy.

## Your Task

- Show that `iptables -L` is not the authority on this box.
- Use `nft monitor` / `xtables-monitor` / `nft trace` (or `bpftool` /
  Cilium Hubble if that is the datapath) to name the drop.
- Fix that rule or policy, and confirm the trace no longer drops the
  4-tuple.

## Starter Files

### file: wrong-tool.txt

```
$ sudo iptables -L INPUT -n
Chain INPUT (policy ACCEPT)
# empty — operator concludes "no firewall"

$ sudo nft list ruleset
table inet filter {
  chain input {
    type filter hook input priority filter;
    tcp dport 8443 drop   comment "incident-2025 leftover"
  }
}
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "iptables-nft vs native nft:"
iptables -V 2>/dev/null || true
sudo nft list ruleset 2>/dev/null | head || true
echo
echo "trace a single flow (nft):"
cat <<'E'
nft add rule inet filter input tcp dport 8443 meta nftrace set 1
nft monitor trace
# other plane:
#   bpftool net
#   cilium policy get / hubble observe --verdict DROPPED
#   tc filter show dev eth0
E
```

## Expected Failure

```bash
sudo iptables -L INPUT -n
# policy ACCEPT, no rules

curl -sv --connect-timeout 3 https://127.0.0.1:8443/
# timeout or refused depending on drop vs reject

# nft counter on "tcp dport 8443 drop" increments
```

The compatibility list lied by omission.

## Expected Outcome

```bash
sudo nft list ruleset
# the leftover drop is gone (or replaced by a documented allow)

curl -sS --connect-timeout 3 http://127.0.0.1:8443/health
# 200

# nft monitor trace no longer shows drop for this 4-tuple
```

You can name the datapath: nftables, iptables-legacy, bpfilter, Cilium,
or `tc`.

## Hints

### Hint 1 — iptables -V

`iptables v1.8.7 (nf_tables)` means `iptables -L` is a translation.
Always `nft list ruleset`. On Kubernetes nodes, also assume kube-proxy
or Cilium owns a hook.

### Hint 2 — Trace beats reading

`meta nftrace set 1` + `nft monitor trace` prints the chain and rule.
Cilium: `hubble observe --verdict DROPPED -t drop`. `iptables -L` will
never show an eBPF policy.

## Solution

Debug the datapath that actually hooks the NIC.

```bash
iptables -V
sudo nft list ruleset
sudo iptables-legacy -L -n 2>/dev/null   # if both stacks exist, you are in hell
# nft trace:
sudo nft add rule inet filter input ip saddr <client> tcp dport 8443 meta nftrace set 1
sudo nft monitor trace
# k8s:
iptables -L -n | head   # kube-proxy
cilium status; hubble observe --to-port 8443
```

- **Empty `iptables -L` is not "no firewall"** on nftables or eBPF
  hosts.
- **Two stacks at once** (legacy + nft) is its own outage class.
- **Trace the skb** instead of arguing about a dump.
- **Cilium/Calico/kube-proxy** may be the only policy that matters;
  host iptables is then a side show.
