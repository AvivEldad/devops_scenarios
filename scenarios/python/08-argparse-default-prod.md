# I forgot the flag and it deployed to production

## Briefing

`rollout.py` is the internal CLI. `--env` defaults to `prod` because "that's
what we usually mean." A new hire ran `python3 rollout.py --tag v2.3.1` from
the laptop to *see the help*, except argparse already parsed a complete
command. It deployed to production with the new tag.

CLIs used in incident response should default to **do nothing dangerous**,
not to production. `argparse` default values are how this ships.

## Your Task

- Run the CLI with only `--tag` and show it targeting prod.
- Make `--env` required, or default to `dev` / dry-run, and refuse `prod`
  without an extra confirmation flag.
- `python3 rollout.py -h` must still work without deploying.

## Starter Files

### file: rollout.py

```python
#!/usr/bin/env python3
import argparse
import sys


def main():
    p = argparse.ArgumentParser(description="Roll a tag to an environment")
    p.add_argument("--env", default="prod", help="target environment")
    p.add_argument("--tag", required=True)
    args = p.parse_args()
    print("deploying %s -> %s" % (args.tag, args.env))
    # pretend: kubectl -n {env} set image ...
    open("last-deploy.txt", "w").write("%s %s\n" % (args.env, args.tag))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Expected Failure

```bash
python3 rollout.py --tag v2.3.1
# deploying v2.3.1 -> prod
cat last-deploy.txt
# prod v2.3.1
```

No prompt. No "did you mean staging". Default did the damage.

## Expected Outcome

```bash
python3 rollout.py --tag v2.3.1; echo exit=$?
# error: --env is required (dev|staging|prod)
# exit=2

python3 rollout.py --env prod --tag v2.3.1
# error: refusing prod without --confirm-prod
# exit=2

python3 rollout.py --env staging --tag v2.3.1
# deploying v2.3.1 -> staging
```

Help still prints and exits 0 without writing `last-deploy.txt`.

## Hints

### Hint 1 — Required beats a dangerous default

`parser.add_argument("--env", required=True, choices=("dev", "staging", "prod"))`.
If you must default, default to `dev` or to a dry-run.

### Hint 2 — Production needs a second key

`--confirm-prod` or `os.environ["I_REALLY_MEAN_PROD"]=1` stops muscle memory
and copy-paste from chat. Log the user and the env on every prod run.

## Solution

Make the unsafe path explicit.

```python
p.add_argument("--env", required=True, choices=("dev", "staging", "prod"))
p.add_argument("--tag", required=True)
p.add_argument("--confirm-prod", action="store_true")
args = p.parse_args()
if args.env == "prod" and not args.confirm_prod:
    print("error: refusing prod without --confirm-prod", file=sys.stderr)
    return 2
```

- **Defaults are for safe values.** Production is not a default.
- **argparse will happily run** if the defaults fill in a complete command.
- **Two-person-style flags** (`--confirm-prod`) are cheap compared to a
  rollback.
- **Shell aliases** (`rollout --env prod`) recreate the bug — keep the
  guard in process, not in muscle memory.
