# Plan says `dev` while you are holding `prod.tfvars`

## Briefing

Friday cutover. The change is a one-line environment bump. `prod.tfvars` is in the
repo, CI ran `terraform plan`, and the plan still shows `environment = "dev"`.
Someone already approved it because "the tfvars file is right there".

Terraform did not ignore your file. It never loaded it.

## Your Task

- Run a plan with only the files on disk and record which environment it uses.
- Get a plan that uses `prod` without renaming the file to `terraform.tfvars`.
- Be able to say which three filenames Terraform auto-loads, and which it does not.

```bash
mkdir -p ~/breakfix/terraform-04 && cd ~/breakfix/terraform-04
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

variable "environment" {
  type    = string
  default = "dev"
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "environment = ${var.environment}\n"
}

output "environment" {
  value = var.environment
}
```

### file: prod.tfvars

```hcl
environment = "prod"
```

### file: ci.sh

```bash
#!/bin/bash
set -euo pipefail
terraform init -input=false
terraform plan -input=false -no-color
```

## Expected Failure

```bash
chmod +x ci.sh && ./ci.sh
```

```
  + content = "environment = dev"
```

`prod.tfvars` is unused. Defaults win. The same plan in production is a
wrong-environment apply.

## Expected Outcome

```bash
terraform plan -var-file=prod.tfvars
# environment = prod

terraform apply -auto-approve -var-file=prod.tfvars
terraform output environment
# "prod"
```

You can name the auto-loaded files: `terraform.tfvars`,
`terraform.tfvars.json`, and `*.auto.tfvars`. Anything else needs `-var-file`.

## Hints

### Hint 1 — A file named for the environment is just a file

`prod.tfvars` is a convention humans like. Terraform only auto-loads:

- `terraform.tfvars` / `terraform.tfvars.json`
- any `*.auto.tfvars` / `*.auto.tfvars.json`

`staging.tfvars`, `prod.tfvars`, `secret.tfvars` are inert until you pass
`-var-file=...`. CI that runs bare `terraform plan` is using defaults.

### Hint 2 — Confirm what was actually loaded

```bash
terraform plan -var-file=prod.tfvars -no-color | grep environment
ls *.tfvars
```

If the filename does not match the auto-load rules, grep the pipeline for
`-var-file`. If it is missing, that is the incident.

## Solution

Pass the file explicitly, in the same command that plans **and** applies:

```bash
terraform plan  -var-file=prod.tfvars -out=tfplan
terraform apply tfplan
```

A saved plan file is safer than hoping apply re-reads the same tfvars.

- **`prod.tfvars` is not magic.** Only `terraform.tfvars` and `*.auto.tfvars`
  load themselves.
- **Defaults are a footgun in CI.** A missing `-var-file` looks like a valid
  plan, just for the wrong env.
- **Plan and apply must see the same values.** Saved plans (`-out`) beat
  re-typing flags.
- **Do not "fix" this by renaming to `terraform.tfvars` in a shared branch**
  unless every workspace is that environment.
