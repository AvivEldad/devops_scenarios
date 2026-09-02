# Terraform refuses to run: core version

## Briefing

Laptop Terraform is fine. CI is not. `terraform init` (and then plan) die
before providers matter:

```
Error: Unsupported Terraform Core version
```

Someone set `required_version` to a constraint the runner does not satisfy —
usually after a local upgrade, a copy-paste from a blog, or a `>= 1.x` that
the image has not caught up with.

## Your Task

- Run `terraform version` and then `terraform init`. Record both numbers.
- Change the constraint so this checkout initialises on the Terraform you
  actually have, **or** document the version CI must install.
- Init and validate successfully.

```bash
mkdir -p ~/breakfix/terraform-07 && cd ~/breakfix/terraform-07
```

## Starter Files

### file: main.tf

```hcl
terraform {
  # Copied from a laptop that had a prerelease / newer image.
  required_version = ">= 1.99.0"

  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

resource "local_file" "ok" {
  filename = "${path.module}/generated/ok.txt"
  content  = "ok\n"
}
```

## Expected Failure

```bash
terraform version
terraform init
```

```
Error: Unsupported Terraform Core version

  on main.tf line 3, in terraform:
   3:   required_version = ">= 1.99.0"

This configuration does not support Terraform version 1.x.y.
To proceed, either choose another supported Terraform version,
or update this version constraint.
```

Nothing is wrong with `local_file`. Core never gets that far.

## Expected Outcome

```bash
terraform init
# Terraform has been successfully initialized!

terraform validate
# Success! The configuration is valid.

terraform plan
# Plan: 1 to add, 0 to change, 0 to destroy.
```

The constraint matches a version you (and CI) can install.

## Hints

### Hint 1 — This error is not a provider problem

`required_version` is checked first. `required_providers` never runs. If you
start tweaking provider source strings you are in the wrong file region.

### Hint 2 — Pin what CI runs, not what your laptop happens to be

```bash
terraform version
# Terraform v1.6.6
```

`>= 1.99.0` will never work on that binary. `>= 1.5` or `~> 1.6.0` might.
Changing the constraint without changing the image is fine for this lab;
in a company, bump **both** together.

## Solution

Set a constraint your installed binary satisfies, and keep it honest:

```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}
```

```bash
terraform init
terraform validate
```

- **`required_version` is a gate, not a wish.** It must match the CLI in
  CI, not the latest HashiCorp blog post.
- **Failing init here is good.** Better than applying with syntax the old
  CLI will misparse.
- **Record the version in the pipeline image** (`tfenv`, `tenv`, official
  GitHub Action `terraform_version`) so laptops cannot drift silently.
