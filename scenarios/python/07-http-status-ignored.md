# The sync job printed OK and the inventory is yesterday's 404 page

## Briefing

`sync_inventory.py` downloads `https://cmdb/api/hosts` and writes
`hosts.json` for Ansible. After the CMDB moved the route to `/v2/hosts`,
the old URL started returning **404 with an HTML body**. The script never
checked the status code. `urlopen` / `requests` only raise on *transport*
failure by default (`requests` needs `raise_for_status()`; urllib *does*
raise on 404 — unless someone used `requests` or a custom opener that
doesn't).

This starter uses a tiny client that treats any TCP success as success —
the pattern in a hundred internal tools that call `resp.read()` and
`json.loads` on an error document, then "parse" zero hosts.

## Your Task

- Serve a 404 (or 500) with a body and show the sync still writing a file
  and exiting 0.
- Fail on any non-2xx, print the status and a snippet of the body, exit
  non-zero, and do not replace the good inventory file.

## Starter Files

### file: fake_cmdb.py

```python
#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"<html>not found — moved to /v2/hosts</html>"
        self.send_response(404)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

HTTPServer(("127.0.0.1", 18082), H).serve_forever()
```

### file: sync_inventory.py

```python
#!/usr/bin/env python3
import json
import sys
from urllib.request import urlopen


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18082/api/hosts"
    # broken: any HTTP response is "success"
    resp = urlopen(url) if False else _open_any(url)
    raw = resp.read()
    path = "hosts.json"
    path_write = path
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"hosts": [], "raw": raw.decode("utf-8", "replace")[:200]}
    open(path_write, "w").write(json.dumps(data, indent=2))
    print("OK wrote %s (%d bytes)" % (path_write, len(raw)))
    return 0


def _open_any(url):
    """Like requests.get without raise_for_status: HTTP errors are returned."""
    from urllib.request import Request, build_opener, HTTPErrorProcessor

    class NoRaise(HTTPErrorProcessor):
        def http_response(self, request, response):
            return response

    opener = build_opener(NoRaise)
    return opener.open(Request(url))


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 fake_cmdb.py &
python3 sync_inventory.py; echo exit=$?
# OK wrote hosts.json (42 bytes)
# exit=0
cat hosts.json
# { "hosts": [], "raw": "<html>not found — moved to /v2/hosts</html>" }
```

Ansible now inventories zero hosts. The pipeline is green.

## Expected Outcome

```bash
python3 sync_inventory.py; echo exit=$?
# error: GET http://127.0.0.1:18082/api/hosts -> 404
# body: <html>not found — moved to /v2/hosts</html>
# exit=1
ls hosts.json
# (previous good file still in place, or absent on first run)
```

2xx only. JSON parse only after that. Write via temp + rename (see later
drill) if you already know that pattern.

## Hints

### Hint 1 — Transport OK is not HTTP OK

`requests.get` returns 404 without throwing. `raise_for_status()` is
required. urllib's default opener *does* raise `HTTPError` on 4xx/5xx —
tools that disable that, or that use `requests`, silently "succeed".

### Hint 2 — Do not parse HTML as empty inventory

If `json.loads` fails, that is an error, not `{hosts: []}`. An empty
inventory is a valid CMDB answer; a 404 page is not.

## Solution

Check status, then parse, then write.

```python
from urllib.error import HTTPError
from urllib.request import urlopen

try:
    with urlopen(url, timeout=5) as resp:
        raw = resp.read()
        status = resp.status
except HTTPError as exc:
    print("error: GET %s -> %s\n%s" % (url, exc.code, exc.read()[:300]),
          file=sys.stderr)
    return 1
if not (200 <= status < 300):
    ...
data = json.loads(raw)
if "hosts" not in data:
    print("error: missing hosts key", file=sys.stderr)
    return 1
```

- **HTTP 4xx/5xx with a body is the usual silent-empty-inventory bug.**
- **`requests` needs `raise_for_status()`.** Remember it in every wrapper.
- **Never translate parse failure into "zero hosts".** That pages the
  wrong team.
- **Keep the last good file** until the new payload validates.
