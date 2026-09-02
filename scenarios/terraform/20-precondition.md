# The precondition failed with the message `invalid`

## Briefing

`terraform plan` dies in a `lifecycle.precondition` (or a `variable`
`validation` block). The message is `invalid` / `validation failed`. You
cannot tell whether env is wrong, a ticket is missing, or the condition is
**inverted** (must be `true` to pass).

The check is doing the right kind of thing with the wrong boolean and a
useless string.

## Your Task

- Run plan in `staging` and in `prod` without a ticket; read both errors.
- Fix the condition so staging applies, prod without a ticket does not.
- Write an error message that includes the offending values.

```bash
mkdir -p ~/breakfix/terraform-20 && cd ~/breakfix/terraform-20
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

variable "env" {
  type    = string
  default = "staging"
}

variable "change_ticket" {
  type    = string
  default = ""
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "env = ${var.env}\n"

  lifecycle {
    precondition {
      # Author meant: "prod requires a ticket". This is true only in prod,
      # so staging is rejected.
      condition     = var.env == "prod"
      error_message = "invalid"
    }
  }
}
```

## Expected Failure

```bash
terraform init
terraform plan
```

```
Error: Resource precondition failed

  on main.tf line 29:
  29:       condition     = var.env == "prod"

invalid
```

Staging is the intended default. The check blocks it. Prod with an empty
ticket would **pass**.

## Expected Outcome

```bash
terraform plan
# Plan: 1 to add ...   (staging, no ticket)

terraform plan -var='env=prod'
# fails, message mentions env=prod and empty change_ticket

terraform plan -var='env=prod' -var='change_ticket=CHG-123'
# Plan: 1 to add ...
```

## Hints

### Hint 1 — Preconditions must evaluate to `true` to proceed

`condition = var.env == "prod"` means "this resource is only valid in
prod". Invert in your head: you wanted `var.env != "prod" || ticket != ""`.

### Hint 2 — Put values in `error_message`

Interpolation is allowed. `"invalid"` wastes the next person's hour.
Include `var.env` and whether the ticket is empty.

## Solution

```hcl
lifecycle {
  precondition {
    condition     = var.env != "prod" || var.change_ticket != ""
    error_message = "prod applies require change_ticket (env=${var.env}, ticket was empty)."
  }
}
```

Same idea on the variable:

```hcl
validation {
  condition     = contains(["staging", "prod"], var.env)
  error_message = "env must be staging or prod, got ${var.env}."
}
```

- **Failed precondition = condition was false.** Start there, not with
  the provider.
- **Invert checks out loud:** "we may apply if ..."
- **Messages are part of the interface.** Treat them like API errors.
