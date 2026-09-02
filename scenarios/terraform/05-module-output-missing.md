# `module.web.addr` does not exist

## Briefing

Root module started using `module.web.addr` in an output and a file. The child
module creates the file just fine. Plan dies on an attribute that nobody
exported.

This is not a provider bug. Modules only leak what they `output`.

## Your Task

- Reproduce the error and read which address Terraform cannot find.
- Export the value from the child so the root reference resolves.
- Apply and print the address from the root output.

```bash
mkdir -p ~/breakfix/terraform-05 && cd ~/breakfix/terraform-05
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

module "web" {
  source = "./modules/web"
  name   = "edge"
}

resource "local_file" "inventory" {
  filename = "${path.module}/generated/inventory.txt"
  content  = "web_addr = ${module.web.addr}\n"
}

output "web_addr" {
  value = module.web.addr
}
```

### file: modules/web/main.tf

```hcl
variable "name" {
  type = string
}

resource "local_file" "site" {
  filename = "${path.module}/generated/${var.name}.conf"
  content  = "name = ${var.name}\n"
}

# The author thought this was visible to the caller.
locals {
  addr = local_file.site.filename
}
```

## Expected Failure

```bash
terraform init
terraform plan
```

```
Error: Unsupported attribute

  on main.tf line 20, in resource "local_file" "inventory":
  20:   content  = "web_addr = ${module.web.addr}\n"

This object does not have an attribute named "addr".
```

`local.addr` inside the child is private. Root cannot see it.

## Expected Outcome

```bash
terraform plan
# Plan: 2 to add, 0 to change, 0 to destroy.

terraform apply -auto-approve
terraform output web_addr
# path to modules/web/generated/edge.conf
```

## Hints

### Hint 1 — Modules are an encapsulation boundary

Root may reference `module.<name>.<output>`. It may **not** reference
`module.web.local_file.site.filename` or a child's `locals`. If the caller
needs a value, the child declares `output`.

### Hint 2 — Name the output after the contract, not the resource

Export `addr` (or `filename`) even if the implementation later changes from
`local_file` to something else. Consumers should not care which resource
produced it.

## Solution

Add an output in the child. Leave the root references as they are.

```hcl
output "addr" {
  value       = local_file.site.filename
  description = "Path to the generated site file"
}
```

```bash
terraform init
terraform apply -auto-approve
terraform output web_addr
```

- **No output means no attribute.** `locals` and resources stay inside the
  module.
- **`module.x.y` is always an output named `y`**, never a resource address.
- **Export the contract** (path, id, name), not the whole resource object,
  unless you intend to couple callers to the provider schema.
