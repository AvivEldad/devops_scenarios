# `templatefile` cannot find a file that is in the module

## Briefing

A shared module renders `templates/app.tftpl`. The template sits next to the
module's `main.tf`. Called from the repo root, plan fails: no such file.

`templatefile("templates/app.tftpl")` is resolved from the **process working
directory**, not from the module. That is why it worked in the module author's
`cd modules/web` demo and dies in CI.

## Your Task

- Run plan from the repo root and from `modules/web`; note which one works.
- Make the module render correctly no matter where Terraform is invoked.
- Apply from the root and confirm the rendered file uses the template.

```bash
mkdir -p ~/breakfix/terraform-06 && cd ~/breakfix/terraform-06
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
  source      = "./modules/web"
  environment = "staging"
}
```

### file: modules/web/main.tf

```hcl
variable "environment" {
  type = string
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = templatefile("templates/app.tftpl", {
    environment = var.environment
  })
}
```

### file: modules/web/templates/app.tftpl

```
environment = ${environment}
```

## Expected Failure

From the repo root:

```bash
terraform init
terraform plan
```

```
Error: Invalid function argument

Invalid value for "path" parameter: no file exists at
templates/app.tftpl; this function works only with files that are
distributed as part of the configuration.
```

```bash
cd modules/web && terraform init && terraform plan   # often succeeds
```

## Expected Outcome

From the **root**:

```bash
terraform plan
# Plan: 1 to add ...

terraform apply -auto-approve
cat modules/web/generated/app.conf
# environment = staging
```

`cd` is no longer part of making the module work.

## Hints

### Hint 1 — `file` / `templatefile` are cwd-relative

Those functions do not search relative to the `.tf` file that called them.
`path.module` is the directory of the current module. `path.root` is the root
module. `path.cwd` is where you ran the CLI (changed by `-chdir`).

### Hint 2 — Always prefix module assets

```hcl
templatefile("${path.module}/templates/app.tftpl", { ... })
```

Same for `file()`, `fileset()`, and `abspath()`. A module that requires you
to `cd` into it is broken.

## Solution

Resolve the template from the module directory:

```hcl
content = templatefile("${path.module}/templates/app.tftpl", {
  environment = var.environment
})
```

- **`path.module` for files shipped with the module.** That is the usual
  fix.
- **`path.root` for files the caller owns** (policies, extra templates
  passed in).
- **`path.cwd` follows the shell / `-chdir`**, so it is the wrong default
  for module assets.
- **A demo that only works inside the module directory will fail CI.**
