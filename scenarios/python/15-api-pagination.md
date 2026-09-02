# The audit said 30 IAM keys and the account has 400

## Briefing

`list_keys.py` calls an HTTP API that paginates (GitHub, GitLab, AWS-style
`NextToken`, Kubernetes `continue`). The script reads the first JSON
document, writes it, prints `found 30`, exits 0. The API's default page
size is 30. Compliance, cost, and "who still has a key" are all wrong.

This is the standard incomplete-inventory incident. Nothing threw. The
first page looks like a complete list.

## Your Task

- Run against the fake API and show only page 1 is consumed.
- Follow `next` / `Link` / `NextToken` until it is absent.
- Fail if a page is missing the cursor you were told to expect, rather
  than treating that as "done".

## Starter Files

### file: fake_api.py

```python
#!/usr/bin/env python3
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

PAGES = {
    "/keys": {"items": [{"id": i} for i in range(1, 31)], "next": "/keys?page=2"},
    "/keys?page=2": {"items": [{"id": i} for i in range(31, 61)], "next": "/keys?page=3"},
    "/keys?page=3": {"items": [{"id": i} for i in range(61, 76)], "next": None},
}

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        key = self.path
        body = json.dumps(PAGES.get(key, {"error": "nope"})).encode()
        self.send_response(200 if key in PAGES else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

HTTPServer(("127.0.0.1", 18083), H).serve_forever()
```

### file: list_keys.py

```python
#!/usr/bin/env python3
import json
import sys
from urllib.request import urlopen


def main():
    url = "http://127.0.0.1:18083/keys"
    with urlopen(url, timeout=5) as resp:
        data = json.loads(resp.read().decode())
    items = data["items"]
    print("found %d keys" % len(items))
    json.dump(items, open("keys.json", "w"), indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 fake_api.py &
python3 list_keys.py
# found 30 keys
```

75 keys exist. The report is 30. Exit 0.

## Expected Outcome

```bash
python3 list_keys.py
# found 75 keys
python3 -c "import json; print(len(json.load(open('keys.json'))))"
# 75
```

A truncated run (HTTP error mid-pagination) must exit non-zero and not
publish `keys.json` as complete.

## Hints

### Hint 1 — Look for next / continue / Link

GitHub: `Link: <...>; rel="next"`. AWS: `NextToken` / `IsTruncated`.
K8s: `metadata.continue`. If the field exists and you did not loop, you
are not done.

### Hint 2 — Cap the loop

`while url:` with a `max_pages` so a bad cursor cannot spin forever.
Log page number and running count so a 30-vs-400 discrepancy is obvious
in the job log.

## Solution

```python
url = "http://127.0.0.1:18083/keys"
items = []
while url:
    with urlopen(url, timeout=5) as resp:
        data = json.loads(resp.read().decode())
    items.extend(data["items"])
    url = data.get("next")
    if url and url.startswith("/"):
        url = "http://127.0.0.1:18083" + url
print("found %d keys" % len(items))
```

- **The first page is a page**, not the resource.
- **A round number (30, 50, 100)** in the result is a pagination smell.
- **Do not publish a partial file** as the inventory of record.
- **SDK list paginators exist** (`boto3` paginator, GitHub
  `paginated_list`) — use them instead of `list_objects()[0]`.
