# Remote state outputs are empty (wrong key)

## Briefing

The app stack interpolates `data.terraform_remote_state.net.outputs.cidr`.
It is empty or the data source errors. The network stack was applied; the
app is pointed at **dev's** state file (or the `default` workspace) while
network lives under **staging**.

No AWS required: both backends are `local` files. The bug is the path.

## Your Task

- Plan the app stack and record the error (or empty output).
- Point `terraform_remote_state` at the state file that actually has
  `cidr`.
- Plan again and see `10.20.0.0/16`.

```bash
mkdir -p ~/breakfix/terraform-19 && cd ~/breakfix/terraform-19
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

data "terraform_remote_state" "net" {
  backend = "local"
  config = {
    path = "${path.module}/remote/dev/terraform.tfstate"
  }
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "cidr = ${data.terraform_remote_state.net.outputs.cidr}\n"
}
```

### file: remote/dev/terraform.tfstate

```json
{
  "version": 4,
  "terraform_version": "1.5.0",
  "serial": 1,
  "lineage": "11111111-1111-1111-1111-111111111111",
  "outputs": {},
  "resources": [],
  "check_results": null
}
```

### file: remote/staging/terraform.tfstate

```json
{
  "version": 4,
  "terraform_version": "1.5.0",
  "serial": 4,
  "lineage": "22222222-2222-2222-2222-222222222222",
  "outputs": {
    "cidr": { "value": "10.20.0.0/16", "type": "string" }
  },
  "resources": [],
  "check_results": null
}
```

## Expected Failure

```bash
terraform init
terraform plan
```

```
Error: Missing output

The output variable "cidr" does not exist in the remote state.
```

(If the path is missing entirely, you get "Unable to find remote state".)

## Expected Outcome

```bash
terraform plan
# content = "cidr = 10.20.0.0/16"

terraform apply -auto-approve
cat generated/app.conf
# cidr = 10.20.0.0/16
```

## Hints

### Hint 1 — The data source is another backend lookup

`path` / S3 `key` / `workspace` must match **where the producer wrote
state**, not where you wish it had. `terraform workspace show` in the
network repo is the first question.

### Hint 2 — Empty `outputs: {}` is a successful read of the wrong file

Wrong env file that exists is worse than a 404: you may get empty strings
if you used `try(...)`. Here the output is absent, so Terraform errors.
That is luck.

## Solution

```hcl
config = {
  path = "${path.module}/remote/staging/terraform.tfstate"
}
```

For S3: same bucket, **different key** (`app/staging/terraform.tfstate` vs
`app/dev/...`), or `workspace = "staging"` when the producer used
workspaces.

- **Remote state is just "read that file's outputs".** Mis-point it and
  you couple to the wrong environment.
- **Do not `try()` missing outputs to `""`** — you will apply a blank
  CIDR.
- **Producer must `output` the value.** No output, nothing to consume
  (see the module-output lab).
