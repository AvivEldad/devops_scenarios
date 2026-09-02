# CI picked a different provider version than your laptop

## Briefing

The plan on the laptop added one file. The plan in CI changed a resource you
did not touch. `.terraform.lock.hcl` is in `.gitignore` "because it is
generated". Without the lock file, `terraform init` (especially `-upgrade`)
resolves `~> 3.0` / `>= 3.0.0` to whatever is newest **today**.

Provider minors change resource behaviour. The lock file is how you make
yesterday's plan today.

## Your Task

- Init twice: once as a laptop (keep the lock), once as CI (`init -upgrade`
  with the lock deleted).
- Show that the selected provider version can move.
- Commit the lock file (stop ignoring it) and pin so CI cannot float.

```bash
mkdir -p ~/breakfix/terraform-09 && cd ~/breakfix/terraform-09
```

## Starter Files

### file: main.tf

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0.0"
    }
    local = {
      source  = "hashicorp/local"
      version = ">= 2.0.0"
    }
  }
}

resource "random_id" "suffix" {
  byte_length = 2
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app-${random_id.suffix.hex}.conf"
  content  = "id = ${random_id.suffix.hex}\n"
}
```

### file: .gitignore

```
.terraform/
.terraform.lock.hcl
```

### file: ci.sh

```bash
#!/bin/bash
# How CI initialises: no lock in git, always take newest matching constraint.
set -euo pipefail
rm -f .terraform.lock.hcl
terraform init -upgrade -input=false
terraform providers
```

## Expected Failure

```bash
terraform init
terraform providers
# e.g. hashicorp/random v3.5.x

chmod +x ci.sh && ./ci.sh
# hashicorp/random v3.6.x (or whatever is newest)
```

Same config, different provider artefact. Behaviour and plans can diverge
without any `.tf` change.

## Expected Outcome

`.gitignore` no longer drops `.terraform.lock.hcl`. CI runs `terraform init`
**without** `-upgrade` on every build, and the lock file is reviewed in PRs.

```bash
git check-ignore -v .terraform.lock.hcl || echo "lock is not ignored"
terraform init
grep -A2 'registry.terraform.io/hashicorp/random' .terraform.lock.hcl
```

## Hints

### Hint 1 — The constraint is a range, the lock is a point

`>= 3.0.0` allows 3.1 and 3.99. The lock records the exact version **and**
the package hashes. That is what makes `init` reproducible.

### Hint 2 — `-upgrade` is a deliberate bump

Use `terraform init -upgrade` when you **intend** to move providers, then
commit the new lock. CI that always upgrades is the same class of bug as
floating `latest` on a container image.

## Solution

Stop ignoring the lock file. Tighten constraints if you want a ceiling.

```
.terraform/
# do not ignore .terraform.lock.hcl
```

```hcl
random = {
  source  = "hashicorp/random"
  version = "~> 3.6.0"
}
```

```bash
terraform init
# commit .terraform.lock.hcl
```

- **The lock file is part of the configuration.** Treat it like
  `package-lock.json`.
- **`init -upgrade` in CI is a hidden dependency bump.**
- **Hashes in the lock also pin the mirror** — you notice a swapped
  provider binary.
- **Review lock diffs** the same day you review `.tf` diffs.
