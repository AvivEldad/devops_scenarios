# The file is already there; Terraform wants to create it

## Briefing

`generated/app.conf` was created by hand (or by last week's failed apply
that still wrote the file). State is empty. Plan: **1 to add**. Apply would
treat it as a new resource and may rewrite the file.

`terraform import` attaches an existing object to an address in state so
the next plan can be `No changes` (or a small in-place update), not a
create.

## Your Task

- Run setup so the file exists and state does not know about it.
- Import `local_file.app` using the file path as the import ID.
- Reach a plan with no create of that file.

```bash
mkdir -p ~/breakfix/terraform-13 && cd ~/breakfix/terraform-13
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
  content  = "environment = staging\n"
}
```

### file: setup.sh

```bash
#!/bin/bash
set -euo pipefail
mkdir -p generated
printf 'environment = staging\n' > generated/app.conf
terraform init -input=false
echo "file exists, state should be empty:"
ls -l generated/app.conf
terraform state list || true
```

## Expected Failure

```bash
chmod +x setup.sh && ./setup.sh
terraform plan
```

```
Plan: 1 to add, 0 to change, 0 to destroy.
```

The object already exists on disk. Terraform does not look at the filesystem
until the provider creates/reads via state.

## Expected Outcome

```bash
terraform import local_file.app "$(pwd)/generated/app.conf"
terraform plan
# No changes. Your infrastructure matches the configuration.
```

(If `filename` in config is relative and import used another path, you may
see an in-place update — still not a destroy/create of a second object.)

## Hints

### Hint 1 — Import ID is provider-specific

For `local_file`, the ID is the path of the file. For an AWS instance it is
the instance id. `terraform providers schema` and the resource docs list it.
Guessing is how you import the wrong object.

### Hint 2 — Import does not update the object to match config

It only binds state. If `content` in HCL differs from the file, the next
plan will **update**. Align config to reality first if you must not touch
the file.

## Solution

```bash
terraform init
terraform import local_file.app "${PWD}/generated/app.conf"
terraform plan
```

Terraform 1.5+ can also use an `import` block, then `plan` / `apply` to
write state without a one-shot CLI import.

- **Create in plan + object already exists** is an import (or a
  `terraform apply` that will fight the existing object).
- **Import is a state operation.** It does not "fix" drift in the object.
- **After import, plan is the source of truth** for whether config matches.
