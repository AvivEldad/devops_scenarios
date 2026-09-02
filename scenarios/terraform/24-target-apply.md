# `-target` left the stack half-updated

## Briefing

Someone needed a fast change and ran `terraform apply -target=local_file.app`.
That resource (and its dependencies) moved to `prod`. `local_file.worker`
still has `staging`. The next **full** plan is a surprise: more changes,
sometimes destroys, that the targeted apply never showed.

`-target` is a surgical tool. It is not a partial rollout strategy.

## Your Task

- Run setup (full apply at staging, then a targeted apply after env=prod).
- Diff the two generated files.
- Run a full plan; apply it so both files match.

```bash
mkdir -p ~/breakfix/terraform-24 && cd ~/breakfix/terraform-24
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

variable "environment" {
  type = string
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "environment = ${var.environment}\nrole = app\n"
}

resource "local_file" "worker" {
  filename = "${path.module}/generated/worker.conf"
  content  = "environment = ${var.environment}\nrole = worker\n"
}
```

### file: setup.sh

```bash
#!/bin/bash
set -euo pipefail
terraform init -input=false
terraform apply -auto-approve -var='environment=staging'
terraform apply -auto-approve -var='environment=prod' \
  -target=local_file.app
echo "=== app ===" && cat generated/app.conf
echo "=== worker ===" && cat generated/worker.conf
```

## Expected Failure

```bash
chmod +x setup.sh && ./setup.sh
```

```
=== app ===
environment = prod
=== worker ===
environment = staging
```

```bash
terraform plan -var='environment=prod'
# 1 to change: local_file.worker
```

The targeted apply looked like success. The stack is split-brained.

## Expected Outcome

```bash
terraform apply -auto-approve -var='environment=prod'
grep environment generated/*.conf
# both prod

terraform plan -var='environment=prod'
# No changes.
```

## Hints

### Hint 1 — `-target` includes dependencies, not dependents

Targeting `app` will also create/update resources `app` **references**. It
will not update `worker`, which only shares a variable. People expect
"everything that uses this var" — that is a full plan.

### Hint 2 — Always follow a targeted apply with a full plan

Same as `helm template --show-only`: useful, incomplete. CI should not
merge on a targeted plan.

## Solution

Finish the apply without `-target`:

```bash
terraform apply -var='environment=prod'
```

Use `-target` only to break a cycle or import a stubborn object, then
immediately plan the whole root.

- **A green targeted apply is not a green stack.**
- **Dependents are skipped.** Shared variables do not pull siblings in.
- **The next person's full plan is where the rest of the diff appears** —
  often in a different ticket, which is how it ships unreviewed.
