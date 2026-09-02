# Backend migrated halfway: two state files

## Briefing

The backend `path` (or S3 `key`) changed. Someone ran `terraform init`
**without** `-migrate-state`. Terraform created a second, empty state in
the new location. The old file still has the resources. Plan: create the
world again. Apply would duplicate or fight objects that already exist.

Halfway migration is two sources of truth.

## Your Task

- Run setup (apply on the old path, then switch the backend block).
- Init the way they did; observe an empty state and a create plan.
- Re-run init with `-migrate-state` (or copy the old snapshot) so there is
  one state and an empty plan.

```bash
mkdir -p ~/breakfix/terraform-30 && cd ~/breakfix/terraform-30
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

  backend "local" {
    path = "terraform.tfstate"
  }
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "ok\n"
}
```

### file: setup.sh

```bash
#!/bin/bash
set -euo pipefail
# 1) apply using the *old* backend path
cat > backend.hcl <<'EOF'
path = "old/terraform.tfstate"
EOF
terraform init -backend-config=backend.hcl -input=false
terraform apply -auto-approve
echo "old state:" && ls -l old/terraform.tfstate
# 2) point at the new default path (main.tf backend.path)
echo "now init WITHOUT migrate (the incident)"
terraform init -input=false -reconfigure || true
```

## Expected Failure

```bash
chmod +x setup.sh && ./setup.sh
terraform state list
# empty (new file) or a prompt you answered "no" to copy
terraform plan
# Plan: 1 to add ...
ls old/terraform.tfstate terraform.tfstate
# both exist
```

The generated file is already on disk from the first apply.

## Expected Outcome

A single state file owns `local_file.app`. Plan is empty. The other path
is a backup, not a live backend.

```bash
terraform state list
# local_file.app
terraform plan
# No changes.
```

## Hints

### Hint 1 — `init` without migrate starts over

Changing `backend` is a migration. Terraform will ask to copy state.
`-reconfigure` skips copy. `-migrate-state` performs it. Default on some
CI images is non-interactive "no".

### Hint 2 — You cannot have two live states for one root

S3: old key `app/terraform.tfstate` and new key `app/prod/terraform.tfstate`
both receiving applies is the same split. Pick one; `state pull` / `push`
the contents; delete or freeze the other.

## Solution

From the root **after** the backend block points at the new path:

```bash
terraform init -migrate-state
```

If you already created an empty new state:

```bash
terraform state push old/terraform.tfstate
# or: cp old/terraform.tfstate terraform.tfstate
terraform plan
```

Then archive `old/terraform.tfstate` so nobody inits it again.

- **Backend changes are migrations, not edits.** Use `-migrate-state`.
- **Two state files = two realities.** Plan-create is the symptom.
- **S3 key / workspace prefix changes** are this lab with a bucket.
