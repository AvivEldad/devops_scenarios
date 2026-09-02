# The cert-expiry cron said 12 days left and the cert died at midnight UTC

## Briefing

`certs.py` parses `notAfter` from a PEM or from an API (`2026-09-02T00:00:00Z`)
and compares it to `datetime.now()`. `now()` is **naive local time**.
The parsed expiry is UTC (or naive-without-timezone). On a box with
`TZ=America/New_York`, the script was off by four to five hours and,
around DST, by an extra hour. The ticket "renew 14 days before" fired
late. The cert expired.

Ops jobs that compare times must use **aware UTC** (or a monotonic
deadline). Naive `datetime.now()` is a production bug.

## Your Task

- Compare a UTC expiry to `datetime.now()` and show the remaining time
  change with `TZ`.
- Use timezone-aware UTC (`datetime.now(timezone.utc)`) on both sides.
- Alert when remaining < 14 days with a stable number regardless of TZ.

## Starter Files

### file: certs.py

```python
#!/usr/bin/env python3
import sys
from datetime import datetime

# from openssl x509 -enddate / ACME API
NOT_AFTER = "2026-09-02T00:00:00Z"


def main():
    expiry = datetime.strptime(NOT_AFTER.replace("Z", ""), "%Y-%m-%dT%H:%M:%S")
    remaining = expiry - datetime.now()
    days = remaining.total_seconds() / 86400
    print("notAfter=%s" % NOT_AFTER)
    print("now=%s" % datetime.now())
    print("days_left=%.2f" % days)
    if days < 14:
        print("ALERT renew")
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
TZ=UTC python3 certs.py
# days_left=...   (one number)

TZ=America/New_York python3 certs.py
# days_left=...   (hours different; may flip ALERT vs ok)
# now=... with no UTC offset
```

The same cert, two TZs, two answers. Cron on UTC vs a laptop in Israel
disagrees.

## Expected Outcome

```bash
TZ=UTC python3 certs.py
TZ=America/New_York python3 certs.py
# days_left identical to two decimals
# now=...+00:00 (aware)
```

`Z` / `+00:00` is parsed as UTC, not stripped into a naive local datetime.

## Hints

### Hint 1 — Never subtract naive from naive across sources

`datetime.now()` is local and naive. `strptime` of an ISO stamp without
`%z` is naive UTC-if-you-are-lucky. Python 3.11+: `datetime.fromisoformat(s.replace("Z","+00:00"))`.

### Hint 2 — One timezone in the process

Compute in UTC, log in UTC, page in UTC. Display local only at the UI
edge. `timezone.utc` is in the stdlib.

## Solution

```python
from datetime import datetime, timezone

expiry = datetime.fromisoformat(NOT_AFTER.replace("Z", "+00:00"))
now = datetime.now(timezone.utc)
remaining = expiry - now
```

- **Naive datetimes do not know they are local.** Subtraction still
  "works" and is wrong.
- **Cron `TZ=` and laptop TZ** will disagree until both sides are aware.
- **Certs, tokens, AWS STS, Let's Encrypt** are all UTC. Join them in UTC.
- **DST** makes a one-hour bug a once-a-year outage. Aware UTC does not
  care.
