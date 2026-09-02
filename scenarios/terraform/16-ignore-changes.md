# `ignore_changes` hid the drift permanently

## Briefing

Replicas were bumped in code to `3`. The file on disk still says `1` from a
hotfix. Plan is empty. Someone added `lifecycle { ignore_changes = [content] }`
months ago so "CI would stop fighting the app".

That is the opposite of reconciling drift (the other lab). Here Terraform
is **working as configured**: it will never correct `content` again.

## Your Task

- Apply, then run the setup tamper.
- Show that plan reports no changes while the file is wrong.
- Remove or narrow `ignore_changes` and converge to `replicas = 3` on
  purpose.

```bash
mkdir -p ~/breakfix/terraform-16 && cd ~/breakfix/terraform-16
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

variable "replicas" {
  type    = number
  default = 3
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "replicas = ${var.replicas}\n"

  lifecycle {
    ignore_changes = [content]
  }
}
```

### file: setup.sh

```bash
#!/bin/bash
set -euo pipefail
terraform init -input=false
terraform apply -auto-approve
printf 'replicas = 1\n' > generated/app.conf
echo "disk:"
cat generated/app.conf
```

## Expected Failure

```bash
chmod +x setup.sh && ./setup.sh
terraform plan
# No changes. Your infrastructure matches the configuration.
```

It does not match. `ignore_changes` made Terraform skip `content`.

## Expected Outcome

```bash
terraform plan
# ~ update in-place: content "replicas = 3"

terraform apply -auto-approve
cat generated/app.conf
# replicas = 3
```

If you still need to ignore a computed vendor field, ignore **that
attribute only**, not the whole payload.

## Hints

### Hint 1 — Empty plan is not "healthy"

Empty plan means config vs state vs (selected attributes of) the object
agree. Ignored attributes are excluded from that comparison.

### Hint 2 — `ignore_changes` is sticky

It is for fields the provider or an out-of-band process **owns** (an AMI
root volume size you must not clobber). Application config you want
converged does not belong there.

## Solution

Delete the lifecycle block (or drop `content` from the list):

```hcl
resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "replicas = ${var.replicas}\n"
}
```

```bash
terraform apply -auto-approve
```

To force a one-time rewrite without keeping the ignore:
`terraform apply -replace=local_file.app`.

- **`ignore_changes` is how drift becomes policy.** Use it rarely.
- **A hotfix that edits the object** must be followed by a config change
  (or a replace), not a broader ignore.
- **This lab is not "import / mv until empty".** The empty plan was the
  bug.
