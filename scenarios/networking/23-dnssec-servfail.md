# dig @8.8.8.8 works, the office resolver returns SERVFAIL, the zone looks signed

## Briefing

`dig +norecurse @ns1.example.net www.example.com` is `NOERROR` with an A.
`dig @10.0.0.53 www.example.com` (validating recursive) is `SERVFAIL`.
`dig +cd @10.0.0.53` (checking disabled) returns the A. Unbound/BIND logs
`validation failure` / `BOGUS`.

Someone rotated the ZSK in the zone and did not update DS at the parent, or
the RRSIG expired, or `dnssec-policy` produced a chain the parent still
has old DS for. Clients that do not validate still work, which is why the
status page is green and the office is down.

This is not NXDOMAIN, not a dead NS, and not split horizon. The data exists
and is untrustworthy to a validator.

## Your Task

- Compare `dig` vs `dig +cd` vs `delv` / `dig +dnssec`.
- Read why it is BOGUS (expired RRSIG, DS mismatch, NSEC proof).
- Restore a valid chain (publish matching DS, or correct signatures) so
  validating resolvers return `NOERROR` without `+cd`.

## Starter Files

### file: dig-notes.txt

```
$ dig www.example.com @10.0.0.53
;; status: SERVFAIL
;; flags: qr rd ra; QUERY: 1, ANSWER: 0

$ dig +cd www.example.com @10.0.0.53
;; status: NOERROR
www.example.com.  300  IN  A  203.0.113.10

$ dig +dnssec DS example.com @a.root-servers.net
# DS key tag 12345  vs  zone DNSKEY key tag 67890   <- mismatch after rotation
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
NAME="${1:-www.example.com}"
echo "validating:"; dig +noall +comments "$NAME" @10.0.0.53 | head -5 || true
echo "CD bit:";     dig +cd +short "$NAME" A @10.0.0.53 || true
```

## Expected Failure

```bash
dig www.example.com @10.0.0.53
# SERVFAIL

dig +cd www.example.com @10.0.0.53
# 203.0.113.10

# unbound: validation failure www.example.com. A
# AD flag absent; with +dnssec you may still see RRSIGs that do not chain
```

Non-validating public resolvers may still answer, so "the internet works".

## Expected Outcome

```bash
dig www.example.com @10.0.0.53
# status: NOERROR
# flags: qr rd ra ad     # ad = authentic data

delv @10.0.0.53 www.example.com A
# fully validated
```

DS at the parent matches a DNSKEY that signs the current RRSIGs; signatures
are inside their inception/expiration window.

## Hints

### Hint 1 — SERVFAIL + success with +cd is DNSSEC until proven otherwise

`+cd` clears the Checking Disabled bit's inverse: it asks the resolver not
to validate. If that is the only way to get an answer, do not debug HTTP.

### Hint 2 — Follow DS to DNSKEY to RRSIG

`dig +trace +dnssec`. Check RRSIG expiry (`expiration` in the RRSIG
record), DS key tag vs `DNSKEY`, and that the child still has the key the
parent DS names. `named-checkzone` / `unbound-host -v` help.

## Solution

Fix the chain of trust, not the A record.

```bash
dig +cd +short www.example.com @10.0.0.53
dig DS example.com @a.gtld-servers.net
dig DNSKEY example.com @ns1.example.com
dig +dnssec www.example.com @ns1.example.com
# typical fixes:
# - publish new DS at registrar after KSK rollover
# - resign the zone (expired RRSIG)
# - disable DNSSEC only as a last-resort break-glass (and you will forget)
```

- **Validating SERVFAIL with `+cd` success is BOGUS data**, not an outage
  of the A record.
- **Parent DS is outside your zone file.** Registrar / parent zone must
  change on KSK roll.
- **RRSIGs expire.** A "set and forget" signed zone dies quietly.
- **Do not tell users to switch to 8.8.8.8** as the fix if 8.8.8.8 is
  validating too — it will fail the same way once caches catch up.
