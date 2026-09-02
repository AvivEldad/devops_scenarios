# Yesterday's plan is not today's: the module tracks `main`

## Briefing

`source = "git::https://example.com/org/tf-baseline.git?ref=main"` (or
`ref=v1`). Nobody changed this repo. Overnight a merge to `main` renamed an
output file. This morning's plan destroys and recreates.

Floating git refs are `latest`. The module cache in `.terraform/modules`
hides it until the next `init -upgrade`.

This lab uses **local stand-ins** for two git revisions so you do not need
GitHub.

## Your Task

- Plan against `vendor/baseline` (today's `main`).
- Compare with `vendor/baseline-v1.4.2` (what yesterday locked).
- Pin the source to the immutable stand-in (in real life: a tag or commit
  SHA).

```bash
mkdir -p ~/breakfix/terraform-17 && cd ~/breakfix/terraform-17
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

module "baseline" {
  # Production: git::https://example.com/org/tf-baseline.git?ref=main
  source = "./vendor/baseline"
}

output "policy_path" {
  value = module.baseline.policy_path
}
```

### file: vendor/baseline/main.tf

```hcl
resource "local_file" "policy" {
  filename = "${path.module}/generated/policy-v4.conf"
  content  = "rev = 4\n"
}

output "policy_path" {
  value = local_file.policy.filename
}
```

### file: vendor/baseline-v1.4.2/main.tf

```hcl
resource "local_file" "policy" {
  filename = "${path.module}/generated/policy-v3.conf"
  content  = "rev = 3\n"
}

output "policy_path" {
  value = local_file.policy.filename
}
```

## Expected Failure

```bash
terraform init
terraform plan
# creates .../policy-v4.conf
```

Point at v1.4.2 instead and the path is `policy-v3.conf`. Same root module,
different child. A floating `ref=main` does that between two CI days.

## Expected Outcome

```hcl
source = "./vendor/baseline-v1.4.2"
# real git:  git::https://example.com/org/tf-baseline.git?ref=v1.4.2
# even better:  ?ref=<full-git-sha>
```

```bash
terraform init -upgrade
terraform plan
# policy-v3.conf only, until you *intentionally* bump the ref
```

## Hints

### Hint 1 — `ref=main` is not a version

Every `terraform init -upgrade` can fetch a different commit. Tags that
move (`v1`) are the same bug. Annotated release tags and SHAs do not move.

### Hint 2 — Module lock vs provider lock

`.terraform.lock.hcl` locks **providers**, not git modules. Module SHAs
belong in the `source` string (and in your own docs/changelog).

## Solution

Pin the module. Bump it in a dedicated PR with a plan.

```hcl
module "baseline" {
  source = "./vendor/baseline-v1.4.2"
}
```

Production equivalent:

```hcl
source = "git::https://example.com/org/tf-baseline.git?ref=v1.4.2"
```

- **Floating `main` makes plans non-reproducible.**
- **Provider lock files will not save you** from git module drift.
- **Treat a module bump like a dependency upgrade:** read the changelog,
  plan, apply.
