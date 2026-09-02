# They ran Terraform in the other stack

## Briefing

The repo has two roots: `stacks/edge` and `stacks/core`. CI ran `terraform
apply` from the checkout root (or from the wrong stack). Either there are
"no configuration files", or the **other** stack's files got applied.

`-chdir` exists so the pipeline can stay at repo root. Forgetting it is how
you mutate the wrong state.

## Your Task

- Run Terraform from the repo root and from each stack directory.
- Apply **edge** using `-chdir` without `cd`.
- Confirm `core` was not applied.

```bash
mkdir -p ~/breakfix/terraform-11 && cd ~/breakfix/terraform-11
```

## Starter Files

### file: stacks/edge/main.tf

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

resource "local_file" "edge" {
  filename = "${path.module}/generated/edge.conf"
  content  = "stack = edge\n"
}
```

### file: stacks/core/main.tf

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

resource "local_file" "core" {
  filename = "${path.module}/generated/core.conf"
  content  = "stack = core\n"
}
```

### file: ci.sh

```bash
#!/bin/bash
# Broken: cwd is the repo root, where there is no root module.
set -euo pipefail
terraform init -input=false
terraform apply -auto-approve
```

## Expected Failure

```bash
chmod +x ci.sh && ./ci.sh
```

```
Error: No configuration files

The directory . contains no Terraform configuration files.
```

The other failure mode — `cd stacks/core` when the ticket was edge —
initialises **core** state and writes `core.conf` instead of `edge.conf`.

## Expected Outcome

```bash
terraform -chdir=stacks/edge init
terraform -chdir=stacks/edge apply -auto-approve
test -f stacks/edge/generated/edge.conf
test ! -f stacks/core/generated/core.conf
```

State lives under `stacks/edge/` (`.terraform/`, `terraform.tfstate`), not
the repo root.

## Hints

### Hint 1 — Each directory with `.tf` files is a separate root

There is no implicit "repo-level" compose. Two folders means two states,
two backends, two applies.

### Hint 2 — `-chdir` changes where Terraform looks, not just logs

```bash
terraform -chdir=stacks/edge plan
```

`path.module` / `path.root` inside that run are `stacks/edge`. `path.cwd`
is still the process cwd unless you also `cd`.

## Solution

Pin the stack in CI. Do not rely on whoever last `cd`'d in the job.

```bash
terraform -chdir=stacks/edge init
terraform -chdir=stacks/edge plan -out=tfplan
terraform -chdir=stacks/edge apply tfplan
```

- **One git repo can contain many roots.** Name them in the pipeline.
- **`terraform apply` with no `-chdir` uses `.`.** At the monorepo root
  that is usually empty or the wrong stack.
- **State is created next to the root you inited.** Applying the wrong
  directory is applying a different universe.
