# `dynamic "ingress"` emitted nothing (then exploded on a duplicate key)

## Briefing

The AWS change was a `dynamic "ingress"` block on a security group. Plan
showed **no ingress**. After flipping a boolean, plan died: two rules
wanted the same `for_each` key.

This lab reproduces both failure modes with `local_file` so you do not need
AWS. The `dynamic` snippet in the example file is the production shape.

## Your Task

- Plan with the starter values: zero files (N=0).
- Enable public ingress without fixing the key: duplicate-key error.
- Emit one file per rule, keyed uniquely.

```bash
mkdir -p ~/breakfix/terraform-18 && cd ~/breakfix/terraform-18
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

variable "enable_public" {
  type    = bool
  default = false
}

variable "ingress" {
  type = list(object({
    port = number
    cidr = string
    desc = string
  }))
  default = [
    { port = 443, cidr = "10.0.0.0/8", desc = "https-int" },
    { port = 443, cidr = "0.0.0.0/0",  desc = "https-ext" },
  ]
}

locals {
  # Internal rules were supposed to always apply. The ternary dropped them.
  selected = var.enable_public ? var.ingress : []
  # Wrong uniqueness: both rules are port 443.
  by_port = { for r in local.selected : r.port => r }
}

resource "local_file" "ingress" {
  for_each = local.by_port
  filename = "${path.module}/generated/${each.key}.json"
  content  = jsonencode(each.value)
}
```

### file: production/sg.tf.example

```hcl
resource "aws_security_group" "web" {
  name = "web"

  dynamic "ingress" {
    for_each = local.by_port
    content {
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      protocol    = "tcp"
      cidr_blocks = [ingress.value.cidr]
      description = ingress.value.desc
    }
  }
}
```

## Expected Failure

```bash
terraform init
terraform plan
# Plan: 0 to add ...     (N=0, selected is [])
```

```hcl
# enable_public = true  (tfvars or -var)
```

```
Error: Duplicate object key
Two different items produced the key "443"
```

## Expected Outcome

```bash
terraform plan -var='enable_public=true'
# Plan: 2 to add ...

terraform apply -auto-approve -var='enable_public=true'
ls generated/
# https-int.json  https-ext.json
```

Internal rules exist even when `enable_public` is false, if that is the
policy you actually wanted.

## Hints

### Hint 1 — Empty `for_each` is a silent "success"

`dynamic "ingress" { for_each = [] }` is valid HCL. You get a security
group with no ingress. Check `length(local.selected)` in `terraform console`.

### Hint 2 — `for_each` keys must be unique

`{ for r in list : r.port => r }` collapses two 443 rules. Key on
`r.desc`, `r.cidr`, or `"${r.port}/${r.cidr}"`.

## Solution

Keep internal CIDRs always; do not key on port alone.

```hcl
locals {
  selected = var.enable_public ? var.ingress : [
    for r in var.ingress : r if r.cidr != "0.0.0.0/0"
  ]
  by_id = { for r in local.selected : r.desc => r }
}

resource "local_file" "ingress" {
  for_each = local.by_id
  filename = "${path.module}/generated/${each.key}.json"
  content  = jsonencode(each.value)
}
```

- **`dynamic` with `for_each = []` is N=0, not an error.**
- **Maps used as `for_each` cannot have duplicate keys.**
- **Inspect `local.*` in `terraform console`** before you blame the
  provider.
