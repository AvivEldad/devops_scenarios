# `for_each` depends on a value unknown until apply

## Briefing

Plan fails:

```
The "for_each" map includes keys derived from resource attributes that
cannot be determined until apply.
```

`random_shuffle.result` (or a remote `id`) is computed. Terraform must know
**addresses** at plan time. You cannot `for_each` over them.

## Your Task

- Run plan and identify which resource attribute is unknown.
- Drive `for_each` from an input that is known at plan (the variable).
- Apply without `-target` gymnastics.

```bash
mkdir -p ~/breakfix/terraform-26 && cd ~/breakfix/terraform-26
```

## Starter Files

### file: main.tf

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

variable "tenants" {
  type    = list(string)
  default = ["alpha", "beta", "gamma"]
}

resource "random_shuffle" "pick" {
  input        = var.tenants
  result_count = 2
}

resource "local_file" "tenant" {
  for_each = toset(random_shuffle.pick.result)
  filename = "${path.module}/generated/${each.key}.conf"
  content  = "tenant = ${each.key}\n"
}
```

## Expected Failure

```bash
terraform init
terraform plan
```

```
Error: Invalid for_each argument

The "for_each" value depends on resource attributes that cannot be
determined until apply, so Terraform cannot predict how many instances
will be created.
```

`random_shuffle.pick.result` is `(known after apply)`.

## Expected Outcome

```bash
terraform plan
# Plan: N to add, with addresses local_file.tenant["alpha"] etc.

terraform apply -auto-approve
ls generated/
```

Instance keys are tenant names from the variable, not a shuffled unknown
list.

## Hints

### Hint 1 — Addresses must be planned

`local_file.tenant["alpha"]` has to exist in the plan graph. If the key
comes from a random result, Terraform cannot even show you the address.

### Hint 2 — `-target` the shuffle first is a trap

Apply `random_shuffle`, then plan the files. That is two applies and a
window where state is half-built. The real fix is a known collection.

## Solution

Iterate the known input. If you only want two tenants, slice the **variable**:

```hcl
resource "local_file" "tenant" {
  for_each = toset(slice(var.tenants, 0, 2))
  filename = "${path.module}/generated/${each.key}.conf"
  content  = "tenant = ${each.key}\n"
}
```

If the set must be random **and** stable, persist the choice in a
`locals` file or a tfvars that is known on the next plan — not in the same
plan as the `for_each`.

- **No `for_each` / `count` on unknown values.**
- **`toset(resource.x.result)` is the usual form of this bug.**
- **`apply -target` is not an architecture.**
