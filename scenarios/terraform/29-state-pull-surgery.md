# `jq` on state without `state mv`: serial mismatch

## Briefing

Someone `terraform state pull > s.json`, deleted a resource with `jq`, and
wrote the file back (or `state push`ed a snapshot with a **lower** serial).
Terraform refuses the push, or accepts a hand-edit that skipped lineage
and checksums. Next plan recreates objects that still exist.

State surgery belongs to `terraform state mv` / `rm` / `replace-provider`,
which update serial correctly.

## Your Task

- Apply setup, then run the broken `jq` edit.
- Try a plan / `state push` and read the serial/lineage error (or the
  surprise create).
- Restore from the backup snapshot using `terraform state push` the
  supported way.

```bash
mkdir -p ~/breakfix/terraform-29 && cd ~/breakfix/terraform-29
```

## Starter Files

### file: main.tf

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "role = app\n"
}

resource "local_file" "worker" {
  filename = "${path.module}/generated/worker.conf"
  content  = "role = worker\n"
}
```

### file: break-state.sh

```bash
#!/bin/bash
set -euo pipefail
terraform init -input=false
terraform apply -auto-approve
cp terraform.tfstate terraform.tfstate.bak
# The incident: drop a resource, decrement serial, keep lineage.
jq 'del(.resources[1]) | .serial -= 1' terraform.tfstate > terraform.tfstate.tmp
mv terraform.tfstate.tmp terraform.tfstate
echo "hand-edited serial=$(jq .serial terraform.tfstate) resources=$(jq '.resources|length' terraform.tfstate)"
```

## Expected Failure

```bash
chmod +x break-state.sh && ./break-state.sh
terraform plan
# 1 to add: the resource jq deleted from state, file still on disk
```

```bash
terraform state push terraform.tfstate.bak
```

If serial on disk is higher than the backup:

```
Error: Cannot overwrite existing state with serial N
```

(`-force` exists; using it without reading lineage is how you lose the
other writer's apply.)

## Expected Outcome

State matches reality again: two resources, files untouched, empty plan.

```bash
terraform state push -force terraform.tfstate.bak   # only because you own this lab
terraform plan
# No changes.
```

Better than `-force`: `state pull` a known-good remote snapshot after
stopping all applies.

## Hints

### Hint 1 — Serial is a monotonic counter

Every successful write increments it. Pushing an older serial is rejected
so a stale laptop cannot clobber CI. `jq '.serial -= 1'` is forging that
counter.

### Hint 2 — `state mv` updates the JSON for you

Address changes, module moves, and provider source changes have first-class
commands. They bump serial and keep lineage. Hand-editing `resources[].name`
skips that.

## Solution

Stop using `jq` as `state mv`. Restore, then do the real operation:

```bash
cp terraform.tfstate.bak terraform.tfstate
terraform state list
terraform state mv local_file.worker local_file.worker_svc   # example
```

If you must push:

```bash
terraform state pull > good.json
# edit only with terraform commands, then:
terraform state push good.json
```

Use `-force` only when you have **compared** lineage and serial and you
are the only writer.

- **Hand-edited state is an unreviewed database migrate.**
- **Serial mismatch is a safety rail** — do not decrement it to "make
  push work".
- **`terraform.tfstate.bak` before surgery** is mandatory.
