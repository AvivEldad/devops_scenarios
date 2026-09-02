# Provider block inside the child module; alias never arrives

## Briefing

Root declares `provider "local" { alias = "out" }` and passes it into a
module. The child still has its own `provider "local" {}` (or never
declares `configuration_aliases`). Plan fails, or the child silently uses a
default provider and writes to the wrong place.

Child modules must **consume** providers, not declare configurations.

## Your Task

- Init/plan and read the provider error.
- Remove the child's `provider` block so the root can pass `local.out`.
- Apply so the file is written once.

```bash
mkdir -p ~/breakfix/terraform-25 && cd ~/breakfix/terraform-25
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

provider "local" {
  alias = "out"
}

module "write" {
  source = "./modules/write"
  name   = "app"
  providers = {
    local = local.out
  }
}
```

### file: modules/write/main.tf

```hcl
terraform {
  required_providers {
    local = {
      source = "hashicorp/local"
    }
  }
}

# Anti-pattern: a new provider config inside the child.
provider "local" {}

variable "name" {
  type = string
}

resource "local_file" "out" {
  filename = "${path.module}/generated/${var.name}.txt"
  content  = "${var.name}\n"
}
```

## Expected Failure

```bash
terraform init
terraform plan
```

Typical errors (wording varies by version):

```
Module module.write contains its own provider configuration
and so cannot be used with the "providers" meta-argument.
```

or, if you delete the pass but keep an alias on the resource:

```
Provider configuration not present
... local.out is required
```

## Expected Outcome

```bash
terraform plan
# Plan: 1 to add ...

terraform apply -auto-approve
cat modules/write/generated/app.txt
# app
```

The child has no `provider {}` block.

## Hints

### Hint 1 — Only the root should configure providers

Credentials, aliases, and region belong in the root (or a dedicated
providers file). Children get them via `providers = { ... }`.

### Hint 2 — Aliases need `configuration_aliases`

If the child refers to `provider = local.out`, the child's `terraform`
block must list it:

```hcl
configuration_aliases = [local.out]
```

The map key in the caller is `local.out`, the value is the root's
`local.out`.

## Solution

Delete `provider "local" {}` from the child. Keep the root map
`providers = { local = local.out }` so the child's default `local` is the
aliased root provider.

Use `configuration_aliases = [local.out]` in the child **only** when it
writes `provider = local.out`; then the root map key is `local.out`.

- **`provider {}` in a child blocks `providers =`.**
- **`configuration_aliases` is the child's declaration of what it needs.**
- **Count/for_each on a module** also require that the child has no
  provider config.
