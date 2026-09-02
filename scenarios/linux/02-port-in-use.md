# Address already in use, and nothing is using it

## Briefing

You are bringing up the `metrics` service on a shared build host. It refuses to start:

```
OSError: [Errno 98] Address already in use
```

You check with the command you always use and it shows nothing listening on that
port. A colleague suggests rebooting the box. It is a shared host, so that is not
happening.

There is a real process holding the port, and after you deal with it the service
fails again for an unrelated reason that is just as instructive.

## Your Task

Run the setup, then get `metrics.py` to start successfully and serve both of its
ports.

1. Find and stop whatever is holding port `8080` — identify it by PID and command
   before you kill anything.
2. Get past the second failure.
3. Leave the host clean: no stray background processes of your own.

You may not reboot, and you may not change the main service port away from `8080`.

```bash
mkdir -p ~/breakfix/linux-02 && cd ~/breakfix/linux-02
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Leaves a stale listener on port 8080, the way a crashed deploy would.
set -euo pipefail

rm -rf lab && mkdir lab && cd lab

cat > stale-service.py <<'EOF'
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers()
        self.wfile.write(b"old build 2024-11-02\n")
    def log_message(self, *a):
        pass

HTTPServer(("0.0.0.0", 8080), H).serve_forever()
EOF

nohup python3 stale-service.py >/dev/null 2>&1 &
disown || true
sleep 1

echo "Setup complete in $(pwd)"
echo "Something is now listening on 8080. You did not start it (pretend)."
```

### file: metrics.py

```python
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

MAIN_PORT = 8080
REDIRECT_PORT = 80


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"metrics ok\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("request %s" % (fmt % args), flush=True)


class Redirect(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(301)
        self.send_header("Location", "http://localhost:%d/" % MAIN_PORT)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def serve(port, handler):
    HTTPServer(("0.0.0.0", port), handler).serve_forever()


print("metrics starting on %d, redirect on %d" % (MAIN_PORT, REDIRECT_PORT), flush=True)
threading.Thread(target=serve, args=(REDIRECT_PORT, Redirect), daemon=True).start()
serve(MAIN_PORT, Handler)
```

## Expected Failure

```bash
bash setup.sh
cd lab
cp ../metrics.py .    # or save metrics.py into this directory
python3 metrics.py
```

```
metrics starting on 8080, redirect on 80
Exception in thread Thread-1:
PermissionError: [Errno 13] Permission denied
...
OSError: [Errno 98] Address already in use
```

Then the misleading part. The command most people reach for reports nothing:

```bash
netstat -tulpn | grep 8080
# bash: netstat: command not found        <- on most modern distros

sudo lsof -i :8080
# sudo: lsof: command not found           <- often not installed either
```

So the port is both occupied and apparently invisible.

## Expected Outcome

The service starts and stays up, serving both ports.

Nothing unexpected holds 8080 before you start:

```bash
ss -ltnp 'sport = :8080'
# empty, or showing only your own metrics.py after you start it
```

The service runs without error:

```bash
python3 metrics.py &
sleep 1
curl -s http://localhost:8080
# metrics ok
```

The redirect port also works, on whichever unprivileged port you moved it to:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:8081
# 301 http://localhost:8080/
```

You can name the process that was squatting the port:

```bash
# in your notes: PID, command line, and start time of the stale listener
```

And you leave nothing behind:

```bash
pkill -f metrics.py
ss -ltnp 'sport = :8080 or sport = :8081'
# empty
```

## Hints

### Hint 1 — netstat is deprecated; use ss

`net-tools` is not installed by default on current Debian, Ubuntu, RHEL or Alpine.
`ss` from `iproute2` is the replacement and is essentially always present:

```bash
ss -ltnp                      # listening, tcp, numeric, with process
ss -ltnp 'sport = :8080'      # filtered to one port
```

The flags are worth memorising: `-l` listening, `-t` TCP, `-u` UDP, `-n` numeric
(do not resolve names, which is also much faster), `-p` show the owning process.

### Hint 2 — You only see the process if you own it or are root

`ss -p` can only show the PID for sockets your user owns. If a different user owns
the process you get the socket but no process information, which looks exactly like
"nothing is there" if you are skimming.

```bash
ss -ltnp 'sport = :8080'      # as you
sudo ss -ltnp 'sport = :8080' # as root, always shows the owner
```

Other ways to the same answer:

```bash
sudo fuser -v 8080/tcp
sudo lsof -i :8080            # if lsof is installed
```

### Hint 3 — Identify before you kill

Once you have the PID, find out what it actually is before terminating it. On a
shared host, killing an unidentified process is how you cause the next incident:

```bash
ps -o pid,ppid,user,etime,cmd -p <PID>
ls -l /proc/<PID>/cwd         # where it was started from
cat /proc/<PID>/cmdline | tr '\0' ' '
```

Then stop it politely first — `kill <PID>` sends `SIGTERM` and lets it clean up.
`kill -9` is `SIGKILL`, which cannot be caught and can leave lock files, partial
writes and corrupted state behind. Escalate only if `SIGTERM` is ignored.

### Hint 4 — The second failure is about the port number itself

`PermissionError` on port 80 is not a bug and not a file permission problem. Ports
below 1024 are privileged: binding one requires root or the `CAP_NET_BIND_SERVICE`
capability. Running the whole service as root to get one port is the wrong trade.

Three legitimate options, in order of preference: use an unprivileged port and put a
reverse proxy or load balancer in front; grant the capability narrowly with
`setcap`; or lower the system-wide threshold with the
`net.ipv4.ip_unprivileged_port_start` sysctl.

## Solution

Two unrelated faults.

**Fault 1 — a stale process is holding 8080.**

```bash
ss -ltnp 'sport = :8080'
# LISTEN 0 5 0.0.0.0:8080 0.0.0.0:* users:(("python3",pid=41233,fd=3))

ps -o pid,user,etime,cmd -p 41233
# 41233 you  00:04:11 python3 stale-service.py

kill 41233
sleep 1
ss -ltnp 'sport = :8080'      # empty
```

If `SIGTERM` is ignored, escalate to `kill -9 41233`, understanding that the process
gets no chance to clean up.

**Fault 2 — port 80 is privileged.**

Change the redirect to an unprivileged port:

```python
REDIRECT_PORT = 8081
```

Then:

```bash
python3 metrics.py &
curl -s http://localhost:8080
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081
```

If the service genuinely must own port 80, the narrow fix is a capability on the
binary rather than running everything as root:

```bash
sudo setcap 'cap_net_bind_service=+ep' /usr/bin/python3
```

That grants the ability to bind low ports to *every* script run by that interpreter,
which is why in practice you put nginx or a load balancer in front instead.

Worth knowing about the `Address already in use` message more generally: it can also
appear with **no process at all**, when a socket sits in `TIME_WAIT` for up to two
minutes after a connection closes. `ss -tan 'sport = :8080'` shows those states.
Servers avoid it by setting `SO_REUSEADDR`, which Python's `HTTPServer` does through
`allow_reuse_address = 1`. If you ever see the error with an empty `ss -ltnp`, that
is your answer.

## What You Learned

The investigation failed at first because of a stale habit — reaching for `netstat`
on a system that has not shipped it for years — and the empty output was read as
evidence rather than as a broken tool. When a diagnostic returns nothing, confirm the
tool works before believing the result.

The other transferable piece is the discipline of identifying a process before
killing it. On a shared host, `ps -p <pid> -o cmd` and `ls -l /proc/<pid>/cwd` cost
two seconds and are the difference between removing a crashed deploy and terminating
somebody's running job.
