# One client says NXDOMAIN, another says SERVFAIL, the name is in the zone file

## Briefing

Laptop A: `dig app.internal` → `NXDOMAIN`. Laptop B: `SERVFAIL`. The zone file
on the master has `app.internal`. The SRE restarted BIND on the master. Laptop A
still NXDOMAINs.

These two errors are not cousins. NXDOMAIN means an authoritative server
asserted the name does not exist (and that answer is cacheable). SERVFAIL means
a resolver could not obtain a trustworthy answer (lame delegation, timeout,
DNSSEC bogus, or the upstream is dead). Treating them as "DNS is flaky" sends
you to the wrong box.

## Your Task

- Capture the flags: `aa`, `ra`, `status: NXDOMAIN` vs `SERVFAIL`.
- Find whether the NXDOMAIN came from a resolver cache or from the wrong
  authority (search domain appending a public TLD, split-horizon miss).
- Restore a `NOERROR` answer with the A/AAAA you intended.

## Starter Files

### file: dig-notes.txt

```
# laptop A (wrong search path / cached denial)
$ dig app.internal
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 1
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 1
;; QUESTION SECTION:
;app.internal.prd.example.net.  IN A     # search domain appended!

# laptop B (resolver cannot reach the internal authority)
$ dig app.internal
;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 2
;; flags: qr rd ra; QUERY: 1, ANSWER: 0
```

### file: resolv.conf.broken

```
search prd.example.net
nameserver 8.8.8.8
# 8.8.8.8 will NXDOMAIN or SERVFAIL for a private name
# missing: nameserver 10.0.0.53   (the internal resolver)
```

## Expected Failure

```bash
dig +noall +comments +question app.internal
# status: NXDOMAIN   and the question is app.internal.prd.example.net.

# or
# status: SERVFAIL   question stays app.internal.  (resolver got nothing usable)
```

The zone on the master can be perfect while every client still fails.

## Expected Outcome

```bash
dig +short app.internal A
# 10.4.12.80

dig app.internal
# status: NOERROR  flags include ra (from a recursive) or aa (from authority)
```

`resolv.conf` (or systemd-resolved) points at a resolver that can see the
internal zone, and search domains do not rewrite the query onto a public name.

## Hints

### Hint 1 — Read the QUESTION section

NXDOMAIN for `app.internal.prd.example.net` is not a failure of `app.internal`.
`search` and `ndots` in resolv.conf append suffixes. Use `dig app.internal.`
(trailing dot) to skip search.

### Hint 2 — SERVFAIL is the resolver, not the name

SERVFAIL: try `dig @<authority> app.internal` vs `dig @<recursive>`. If the
authority answers and the recursive does not, the recursive cannot reach it,
is lame, or is failing DNSSEC. If the authority itself SERVFAILs, look at
its logs, not at `/etc/hosts`.

## Solution

Fix the question, then fix which server answers it.

```bash
dig app.internal.            # trailing dot: no search
dig +trace app.internal.
cat /etc/resolv.conf         # nameserver + search
resolvectl query app.internal 2>/dev/null || true

# NXDOMAIN from search: put internal nameserver first, or use FQDNs in apps
# SERVFAIL: point at 10.0.0.53; check that 53/udp and 53/tcp to it work
```

- **NXDOMAIN is authoritative denial** and caches (negative TTL). Flush after
  you really create the record.
- **SERVFAIL is "I could not answer"** — reachability, lame NS, DNSSEC.
- **Always read the QUESTION.** Search domains silently change the name.
- **Trailing dot** in `dig` is the cheapest way to stop guessing about search.
