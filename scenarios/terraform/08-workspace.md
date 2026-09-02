# Staging workspace looks empty after a successful apply

## Briefing

The stack was applied. Files exist. Then someone ran `terraform workspace
select staging` (or created it) because the run was supposed to be staging,
not `default`. Plan now wants to create everything. `terraform.tfstate` still
has the resources — under the other workspace.

Local backend stores `default` in `terraform.tfstate` and every other
workspace in `terraform.tfstate.d/<name>/terraform.tfstate`. Switching
workspace switches **files**, not labels on the same state.

## Your Task

- Run the setup script (apply in `default`, then select `staging`).
- Explain why plan is not empty.
- Put the existing resources in the `staging` workspace without recreating
  the files.

```bash
mkdir -p ~/breakfix/terraform-08 && cd ~/breakfix/terraform-08
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

resource "local_file" "app" {
  filename = "${path.module}/generated/${terraform.workspace}.conf"
  content  = "workspace = ${terraform.workspace}\n"
}
```

### file: setup.sh

```bash
#!/bin/bash
set -euo pipefail
terraform init -input=false
terraform apply -auto-approve
terraform workspace new staging || terraform workspace select staging
echo "current workspace: $(terraform workspace show)"
```

## Expected Failure

```bash
chmod +x setup.sh && ./setup.sh
terraform plan
```

```
Plan: 1 to add, 0 to change, 0 to destroy.
```

```bash
ls terraform.tfstate terraform.tfstate.d/staging/ 2>/dev/null
cat generated/default.conf   # from the first apply
```

Staging state is empty. Default state is not.

## Expected Outcome

`staging` manages the existing file (or a correctly migrated copy), and a
plan in that workspace is not a blank create of "new" infrastructure you
already applied.

```bash
terraform workspace select default
terraform plan
# No changes. Your infrastructure matches the configuration.
```

You know which state file belongs to which workspace.

## Hints

### Hint 1 — `workspace select` does not move state

It changes which state file the CLI reads. Resources in `default` stay in
`terraform.tfstate`. `staging` starts empty unless you migrated.

### Hint 2 — Look at the files before you apply

```bash
terraform workspace list
ls -l terraform.tfstate terraform.tfstate.d/*/terraform.tfstate
```

Remote backends (S3 key + workspace prefix) do the same thing with keys,
not directories.

## Solution

Do not apply again in `staging` if that would duplicate real infrastructure.

To **relabel** a local run that was meant to be staging:

```bash
terraform workspace select default
terraform state pull > /tmp/staging.tfstate
terraform workspace select staging
terraform state push /tmp/staging.tfstate
```

Or copy `terraform.tfstate` to `terraform.tfstate.d/staging/terraform.tfstate`
and then `state rm` from `default` so only one workspace owns the objects.

- **Workspace ≠ directory of `.tf` files.** It is a state namespace.
- **Always `workspace show` in CI** before apply. Pin `TF_WORKSPACE` or
  `-chdir` + an explicit select.
- **`default` is a real workspace**, not a scratch pad. If you meant
  `staging`, select it **before** the first apply.
