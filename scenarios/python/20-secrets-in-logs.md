# The exception handler logged the Authorization header to the shared Slack channel

## Briefing

`call_api.py` catches all exceptions and `print("%s" % exc)` or
`log.exception("request failed: %s", req)` including the `headers` dict.
A 500 from the API dumped `Authorization: Bearer ghp_...` into
CloudWatch, which is forwarded to Slack. The token was revoked an hour
later. The next deploy still has `log.debug(resp.request.headers)`.

Python-01 is a *missing* secret. This is a *present* secret in the
failure path. Tracebacks, `repr(request)`, and verbose HTTP libraries
are the usual leaks.

## Your Task

- Trigger a failure and show the token in the process output.
- Log status, URL path, and a redacted header set; never the bearer
  value.
- Keep `exc.__traceback__` useful without stuffing the Request object
  into the message.

## Starter Files

### file: call_api.py

```python
#!/usr/bin/env python3
import os
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen

TOKEN = os.environ.get("DEPLOY_TOKEN", "ghp_EXAMPLESHOULDNOTLEAK")


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9/deploy"
    req = Request(url, headers={"Authorization": "Bearer %s" % TOKEN})
    try:
        with urlopen(req, timeout=2) as resp:
            print("status", resp.status)
            return 0
    except Exception as exc:
        print("request failed: %r" % req.header_items())
        print("exception: %s" % exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 call_api.py
# request failed: [('Authorization', 'Bearer ghp_EXAMPLESHOULDNOTLEAK')]
# exception: <urlopen error ...>
```

The secret is now in the CI log, the k8s log, and whoever archives
stdout.

## Expected Outcome

```bash
python3 call_api.py; echo exit=$?
# error: GET http://127.0.0.1:9/deploy failed: <urlopen error Connection refused>
# error: authorization header present=yes (redacted)
# exit=1
```

`grep ghp_ /tmp/log` finds nothing. The URL and error class are still
there.

## Hints

### Hint 1 — Do not log the Request / Response object

`repr(req)` and `requests` `PreparedRequest` include headers. Log
`req.full_url` and `type(exc).__name__`. Use `log.exception("call failed")`
without interpolating the request.

### Hint 2 — Redact a copy

`headers = {k: ("<redacted>" if k.lower() == "authorization" else v) for k, v in ...}`.
Also cookie, x-api-key, token query params (`?access_token=`).

## Solution

```python
except URLError as exc:
    log.error("GET %s failed: %s", url.split("?")[0], exc.reason)
    log.error("authorization header present=%s", "yes" if TOKEN else "no")
    return 1
```

- **Failure paths leak more than success paths.** Review `except`.
- **CI logs are public to the org** (and sometimes to forks). Treat them
  as the internet.
- **`log.exception` without the request object** still gives a traceback.
- **Revoke anything that was printed.** Then fix the print.
