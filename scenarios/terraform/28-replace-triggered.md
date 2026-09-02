# Everything replaces because of `replace_triggered_by` and `timestamp()`

## Briefing

Nobody changed `local_file.app`. Every plan wants to **replace** it. A
`random_id` used as a tag/nonce has `keepers = { rolled = timestamp() }`,
and the file has `replace_triggered_by = [random_id.nonce]`.

`timestamp()` is computed at plan, always new. That is a forced recreation
every run — the same class of bug as tagging an instance with a computed
value that `requires_replace`.

Distinct from the unique-name / `create_before_destroy` lab: here the
replace is unexpected, not colliding.

## Your Task

- Apply once, plan again immediately, observe a replace.
- Stop the nonce from changing every plan.
- Reach empty plans until `var.release` actually changes.

```bash
mkdir -p ~/breakfix/terraform-28 && cd ~/breakfix/terraform-28
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

variable "release" {
  type    = string
  default = "1"
}

resource "random_id" "nonce" {
  byte_length = 4
  keepers = {
    rolled = timestamp()
  }
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "release = ${var.release}\n"

  lifecycle {
    replace_triggered_by = [random_id.nonce]
  }
}
```

## Expected Failure

```bash
terraform init
terraform apply -auto-approve
terraform plan
```

```
-/+ destroy and then create replacement
  # local_file.app must be replaced
Plan: 1 to add, 0 to change, 1 to destroy.
```

`random_id.nonce` also wants replacement because `timestamp()` moved.

## Expected Outcome

```bash
terraform apply -auto-approve
terraform plan
# No changes.

terraform plan -var='release=2'
# replace (or update) only because release changed, if you still
# trigger on the nonce *and* the nonce keepers include var.release
```

## Hints

### Hint 1 — `timestamp()` is never stable

It is known at plan, different every plan. Same for `uuid()` without a
keeper. Do not put them in `keepers`, tags that `ForceNew`, or
`replace_triggered_by`.

### Hint 2 — `replace_triggered_by` is a shotgun

Any change to the referenced resource (including replacement of
`random_id`) replaces **this** resource. Point it at something you
actually intend to roll, like `terraform_data.roll` with
`input = var.release`.

## Solution

Key the nonce on the release, not the clock:

```hcl
resource "random_id" "nonce" {
  byte_length = 4
  keepers = {
    release = var.release
  }
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "release = ${var.release}\n nonce = ${random_id.nonce.hex}\n"
}
```

Drop `replace_triggered_by` unless you **want** the file recreated when
the nonce rolls.

- **Computed tags / timestamps are a common ForceNew.**
- **`replace_triggered_by` multiplies that ForceNew** onto otherwise
  in-place resources.
- **Second plan after apply must be empty** or you have a generator in
  the graph.
