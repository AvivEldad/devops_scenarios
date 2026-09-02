# Every hourly run created another DNS record named `app-` plus a timestamp

## Briefing

`ensure_record.py` was meant to be idempotent: if the CNAME exists, leave
it; if not, create it. The implementation always `POST`s. The API is
happy to create `app`, `app`, `app` as three objects with generated ids.
After a month of cron, there are 720 records. Lookups are non-deterministic.
The dashboard "create vs update" was never wired.

DevOps automation that talks to cloud/DNS/Jira **must be safe to re-run**.
POST-every-time is how you get duplicate alarm policies, duplicate IAM
users, and duplicate hostnames.

## Your Task

- Run the script twice against the fake API and show two records.
- GET-or-create (or PUT by stable id / name): second run is a no-op.
- Exit 0 both times; print `created` vs `already exists`.

## Starter Files

### file: fake_dns.py

```python
#!/usr/bin/env python3
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

RECORDS = []

class H(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/records":
            self._json(200, {"items": RECORDS})
            return
        self._json(404, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(n) or b"{}")
        rec = {"id": len(RECORDS) + 1, "name": body.get("name"), "target": body.get("target")}
        RECORDS.append(rec)
        self._json(201, rec)

    def log_message(self, *a):
        pass

HTTPServer(("127.0.0.1", 18086), H).serve_forever()
```

### file: ensure_record.py

```python
#!/usr/bin/env python3
import json
import sys
from urllib.request import Request, urlopen

API = "http://127.0.0.1:18086"


def main():
    name, target = "app.internal", "lb.internal"
    req = Request(
        API + "/records",
        data=json.dumps({"name": name, "target": target}).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urlopen(req, timeout=5) as resp:
        created = json.loads(resp.read().decode())
    print("created", created)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 fake_dns.py &
python3 ensure_record.py
python3 ensure_record.py
curl -s http://127.0.0.1:18086/records
# {"items":[{"id":1,"name":"app.internal",...},{"id":2,"name":"app.internal",...}]}
```

Two objects, one name. DNS/API behaviour from here is undefined.

## Expected Outcome

```bash
python3 ensure_record.py
# created id=1 name=app.internal
python3 ensure_record.py
# already exists id=1 name=app.internal
curl -s http://127.0.0.1:18086/records
# {"items":[{"id":1,...}]}
```

A third run still does not POST.

## Hints

### Hint 1 — Look up by the natural key first

`GET /records` (or `?name=app.internal`). If present, compare `target`,
PATCH if drifted, else no-op. POST only when missing.

### Hint 2 — PUT to a stable URL is simpler

`PUT /records/app.internal` that the server treats as upsert. If the API
only has POST, you still have to search first — and lock (drill 19) if
two crons race.

## Solution

```python
with urlopen(API + "/records", timeout=5) as resp:
    items = json.loads(resp.read().decode())["items"]
match = [r for r in items if r["name"] == name]
if match:
    print("already exists", match[0])
    return 0
# else POST as before
```

- **Idempotent means a second run is a no-op** (or converges), not
  "creates another".
- **Natural keys** (DNS name, IAM user name, alarm name) beat generated
  ids in the cron.
- **Terraform/Ansible exist** because POST-from-Python forgot this.
  If you stay in Python, you own upsert.
- **Racy double POST** needs a lock or a server-side unique constraint.
