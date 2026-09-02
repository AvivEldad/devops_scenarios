# Process substitution hid the curl exit code

## Briefing

`jq . < <(curl -fsS "$url")` or `diff <(curl a) <(curl b)` looks elegant. Curl
fails (404, timeout) and jq errors on empty input — or worse, jq exits 0 on
`null` and the pipeline is "fine". The curl status is lost because it is not in
the current shell's `pipefail` chain the way you think; `< <( )` is a
redirection from a background process.

You need `curl` status, body, and a timeout, not a clever substitution.

## Your Task

- Use process substitution with a failing curl and show the script still exits 0
  (or fails for the wrong reason).
- Capture HTTP body and status with a temp file or `curl -w`.
- Make failure mean "curl failed" not "jq parse error".

## Starter Files

### file: fetch.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
jq -e . < <(curl -fsS "https://example.invalid/api")
echo "reached the end, exit would be $?"
```

## Expected Failure

```bash
bash fetch.sh
# curl: (6) Could not resolve host
# jq: parse error: ...
# (script may exit 4 from jq, or 0 if jq is not -e)
```

You cannot tell DNS failure from bad JSON from the exit code without reading
stderr. `set -e` may abort on jq, hiding that curl already failed. Some bash
versions do not abort on the process substitution's status at all.

## Expected Outcome

Curl's failure is the script's failure; JSON is only parsed after HTTP 200.

```bash
bash fetch.sh
# curl failed: HTTP 000 / resolve error
# exit=22   (or 6) — a curl code, not jq's
```

## Hints

### Hint 1 — Write to a file, then parse

```bash
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
code=$(curl -fsS -o "$tmp" -w '%{http_code}' "$url" || true)
[[ $code == 200 ]] || { echo "http $code"; exit 1; }
jq -e . "$tmp"
```

`-w '%{http_code}'` separates body and status. `-f` makes curl exit non-zero on
HTTP errors.

### Hint 2 — PIPESTATUS does not see <( )

`PIPESTATUS` is for `|` pipelines. Process substitution is not a pipe member.
`wait $!` after `< <( )` is racy. Do not use `< <(curl)` when you need the
status.

## Solution

Temp file + HTTP code; jq only on success.

```bash
#!/usr/bin/env bash
set -euo pipefail
url="https://example.invalid/api"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
http=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 10 "$url" || true)
if [[ $http != 200 ]]; then
  echo "curl HTTP $http" >&2
  exit 1
fi
jq -e . "$tmp"
```

- **Clever substitutions hide status.** Readable scripts win in on-call.
- **`curl -f` + `pipefail` + `curl | jq`** still conflates 404 body with jq.
  `-w` + `-o` is cleaner.
- **`diff <( ) <( )`** is fine for two local commands you trust; not for HTTP.
- **`set -o errtrace` / `inherit_errexit`** still will not make `< <(false)`
  reliable across bash versions — avoid it for critical status.
