# Terraform will not even initialise

## Briefing

You pulled a colleague's branch to review their infrastructure change and cannot get
as far as a plan. `terraform init` fails, and once you get past that, `validate`
fails, and once you get past that, `plan` fails.

Four small mistakes, each producing a different error at a different stage of the
Terraform lifecycle. Learning to read which stage failed is most of the skill.

> This scenario uses only the `local` and `random` providers, so it creates files on
> your disk and nothing in any cloud. No credentials, no account, no cost.

## Your Task

Save the files and get to a clean `terraform apply`.

1. Fix the errors one at a time, in the order Terraform reports them.
2. For each one, note *which command* surfaced it — `init`, `validate`, or `plan`.
   That mapping is the transferable knowledge here.
3. Apply successfully and confirm the generated files are correct.

```bash
mkdir -p ~/breakfix/terraform-01 && cd ~/breakfix/terraform-01
```

## Starter Files

### file: main.tf

```hcl
terraform {
  required_version = ">= 1.5"

  required_providers {
    local = {
      source = "hashicorp/local"
    }
    random {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

resource "random_pet" "suffix" {
  length = 2
}

resource "local_file" "config" {
  filename = "${path.module}/generated/app-${random_pet.suffix.id}.conf"

  content = <<-EOT
    environment = ${var.environment}
    replicas    = ${var.replica_count}
    region      = ${var.aws_region}
    debug       = ${var.enable_debug}
  EOT
}

resource "local_file" "readme" {
  filename = "${path.module}/generated/README.txt"
  content  = "Generated for ${var.environment} by ${local_file.config.name}\n"
}

output "config_path" {
  value = local_file.config.filename
}

output "pet_name" {
  value = random_pet.suffix.id
}
```

### file: variables.tf

```hcl
variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"
}

variable "replica_count" {
  description = "Number of application replicas"
  type        = number
  default     = "three"
}

variable "enable_debug" {
  description = "Turn on verbose logging"
  type        = bool
  default     = false
}
```

## Expected Failure

Each stage stops you with a different class of error.

**Stage 1 — `terraform init`:**

```bash
terraform init
```

```
Error: Invalid block definition

  on main.tf line 8, in terraform:
   8:     random {

Either a quoted string block label or an opening brace ("{") is expected here.
```

This is a syntax error, so Terraform cannot even parse the configuration to work out
which providers it needs.

**Stage 2 — `terraform validate`:**

```
Error: Reference to undeclared input variable

  on main.tf line 25, in resource "local_file" "config":
  25:     region      = ${var.aws_region}

An input variable with the name "aws_region" has not been declared.
```

**Stage 3 — still `validate`:**

```
Error: Unsupported attribute

  on main.tf line 33, in resource "local_file" "readme":
  33:   content  = "Generated for ${var.environment} by ${local_file.config.name}"

This object has no argument, nested block, or exported attribute named "name".
```

**Stage 4 — `terraform plan`:**

```
Error: Invalid value for input variable

The given value is not suitable for var.replica_count declared at
variables.tf:7,1-24: a number is required.
```

## Expected Outcome

A clean run through the whole lifecycle.

Init succeeds and locks the providers:

```bash
terraform init
# Terraform has been successfully initialized!

ls .terraform.lock.hcl
```

Formatting and validation are clean:

```bash
terraform fmt -check
# (no output, exit 0)

terraform validate
# Success! The configuration is valid.
```

Plan shows exactly three resources to create and no errors:

```bash
terraform plan
# Plan: 3 to add, 0 to change, 0 to destroy.
```

Apply produces the files:

```bash
terraform apply -auto-approve
ls generated/
# README.txt   app-<random-pet-name>.conf
```

The generated config has real values substituted, with no empty fields:

```bash
cat generated/app-*.conf
```

```
environment = dev
replicas    = 3
region      = eu-west-1
debug       = false
```

The README correctly references the config file's path:

```bash
cat generated/README.txt
# Generated for dev by ./generated/app-<name>.conf
```

Outputs resolve:

```bash
terraform output config_path
terraform output pet_name
```

And a second plan is empty, proving the config converges:

```bash
terraform plan
# No changes. Your infrastructure matches the configuration.
```

Clean up when you are done:

```bash
terraform destroy -auto-approve
```

## Hints

### Hint 1 — Learn which command catches which class of error

This is the single most useful takeaway from the scenario:

| Command | Catches |
|---|---|
| `terraform fmt` | formatting only, never semantics |
| `terraform init` | HCL syntax, provider resolution, backend configuration |
| `terraform validate` | references, types, argument names — offline, no state, no credentials |
| `terraform plan` | variable values, state comparison, provider-side validation |

`validate` is the one people skip. It needs no credentials and no state, so it
belongs in every pull request check.

### Hint 2 — Block syntax inside required_providers

Compare the two entries:

```hcl
local = {
  source = "hashicorp/local"
}
random {
  source = "hashicorp/random"
}
```

`required_providers` takes a **map**, so every entry needs `=` before the brace. The
second is written as a block, which is a different HCL construct entirely — hence
"Invalid block definition".

While you are there: `local` has no version constraint. Add one. Unconstrained
providers mean a future `init -upgrade` can pull a major version with breaking
changes.

### Hint 3 — Every variable must be declared

`var.aws_region` is used but never declared in `variables.tf`. Terraform has no
implicit variables — using one is always an error, not an empty string.

Declare it with a type, a description, and a sensible default. Adding a
`validation` block is a good habit for anything with a constrained set of values.

### Hint 4 — Look up the resource's real attributes

`local_file.config.name` does not exist. To find what a resource actually exports,
read its documentation or ask the state:

```bash
terraform providers schema -json | python3 -m json.tool | less
```

For `local_file`, the useful attributes are `filename`, `content`, `content_base64`,
`id`. You want the path.

### Hint 5 — Type constraints are enforced at plan time

`default = "three"` on a `type = number` variable is a string. Terraform will convert
`"3"` to `3` because that is unambiguous, but `"three"` cannot be converted.

Note that this error appeared at `plan`, not `validate` — declared types are checked
when values are resolved. This is why a config can validate cleanly and still fail on
a bad `.tfvars` file.

## Solution

Four errors, one per lifecycle stage.

### The corrected `main.tf`

```hcl
terraform {
  required_version = ">= 1.5"

  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

resource "random_pet" "suffix" {
  length = 2
}

resource "local_file" "config" {
  filename = "${path.module}/generated/app-${random_pet.suffix.id}.conf"

  content = <<-EOT
    environment = ${var.environment}
    replicas    = ${var.replica_count}
    region      = ${var.aws_region}
    debug       = ${var.enable_debug}
  EOT
}

resource "local_file" "readme" {
  filename = "${path.module}/generated/README.txt"
  content  = "Generated for ${var.environment} by ${local_file.config.filename}\n"
}

output "config_path" {
  value = local_file.config.filename
}

output "pet_name" {
  value = random_pet.suffix.id
}
```

### The corrected `variables.tf`

```hcl
variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "replica_count" {
  description = "Number of application replicas"
  type        = number
  default     = 3

  validation {
    condition     = var.replica_count > 0
    error_message = "replica_count must be greater than zero."
  }
}

variable "aws_region" {
  description = "Region recorded in the generated configuration"
  type        = string
  default     = "eu-west-1"
}

variable "enable_debug" {
  description = "Turn on verbose logging"
  type        = bool
  default     = false
}
```

Run it through:

```bash
terraform fmt
terraform init
terraform validate
terraform plan
terraform apply -auto-approve
cat generated/app-*.conf
```

Two things worth noticing beyond the fixes themselves.

**Implicit dependencies.** `local_file.readme` references
`local_file.config.filename`, and that reference is what tells Terraform to create
`config` first. You almost never need `depends_on` — build the graph by referencing
attributes, and reserve `depends_on` for genuine ordering requirements that are
invisible in the data.

**Version constraints.** `~> 3.6` allows `3.6.x` and `3.7`, but not `4.0`. Combined
with the committed `.terraform.lock.hcl`, this is what makes a build reproducible.
Commit the lock file; it records exact versions and provider hashes.

## What You Learned

Four bugs, four different commands to find them, and the errors were accurate and
well-located every time. Terraform is unusually good at this, and the skill is
reading the message rather than pattern-matching it against a previous problem.

The workflow to make automatic: `fmt`, `init`, `validate`, `plan`, and only then
`apply`. `validate` in particular is free — no credentials, no state, no API calls —
so there is no reason for it not to run on every commit. Most of the errors in this
scenario would never reach a reviewer if it did.
