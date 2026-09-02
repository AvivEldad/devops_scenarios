# Renaming a resource destroys it

## Briefing

A reviewer asked to rename `local_file.app` to `local_file.app_config`. The
plan is destroy + create. On a local file that is a flicker. On a database
it is an outage.

This is **not** the `count` index shift (that is a different lab). The
address string changed. Terraform identity **is** the address. `moved {}`
tells state the new name is the same object.

## Your Task

- Run setup (apply at the old address, then use this renamed config).
- Observe destroy + create.
- Add a `moved` block so plan is a no-op (or a state-only move).

```bash
mkdir -p ~/breakfix/terraform-14 && cd ~/breakfix/terraform-14
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

# Renamed from local_file.app — no moved block yet.
resource "local_file" "app_config" {
  filename = "${path.module}/generated/app.conf"
  content  = "ok\n"
}
```

### file: setup.sh

```bash
#!/bin/bash
set -euo pipefail
terraform init -input=false
# Last week's address:
cat > /tmp/old.tf <<'EOF'
terraform {
  required_providers {
    local = { source = "hashicorp/local", version = "~> 2.5" }
  }
}
resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "ok\n"
}
EOF
cp main.tf main.tf.renamed
cp /tmp/old.tf main.tf
terraform apply -auto-approve
mv main.tf.renamed main.tf
terraform state list
```

## Expected Failure

```bash
chmod +x setup.sh && ./setup.sh
terraform plan
```

```
- destroy local_file.app
+ create local_file.app_config
Plan: 1 to add, 0 to change, 1 to destroy.
```

Same filename, new address: destroy deletes the file, create writes it
again. `mtime` jumps; anything watching the path flaps.

## Expected Outcome

```bash
terraform plan
# No changes. Your infrastructure matches the configuration.

terraform state list
# local_file.app_config
```

The file is not deleted.

## Hints

### Hint 1 — Address is identity

`local_file.app` and `local_file.app_config` are different resources to
Terraform even if every argument is identical. Git rename of a label is a
replace unless you record the move.

### Hint 2 — `moved` is a state instruction in config

```hcl
moved {
  from = local_file.app
  to   = local_file.app_config
}
```

One apply (or even a plan in recent versions) rewrites the address. You can
remove the `moved` block in a later PR once every state has been upgraded.

## Solution

Add this next to the renamed resource:

```hcl
moved {
  from = local_file.app
  to   = local_file.app_config
}
```

```bash
terraform plan
# will show a move, not a replace
terraform apply -auto-approve
```

Equivalent CLI: `terraform state mv local_file.app local_file.app_config`.
Prefer `moved` in git so every workspace gets the same rewrite.

- **Renames in HCL are replaces** until you `moved` / `state mv`.
- **This is not `count` → `for_each`.** That migration uses `moved` too,
  but the trigger here is a label change.
- **Leave `moved` in the repo until all states have applied it.**
