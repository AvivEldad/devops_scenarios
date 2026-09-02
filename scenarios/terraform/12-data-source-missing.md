# The data source has nothing to read

## Briefing

Plan fails on `data.local_file.seed` because `seed.json` is not on disk
(never committed, wrong path, or produced by another stack that was not
applied). The same class of bug with `data.terraform_remote_state` is a
wrong key/workspace: the data source "succeeds" with empty outputs or
errors on missing state.

Data sources read **existing** objects at plan/apply time. They are not
defaults.

## Your Task

- Run plan and read the missing-file error.
- Provide the seed file (or correct the path) so plan can read it.
- Optional: point `terraform_remote_state` at a local state that actually
  contains the output you interpolate.

```bash
mkdir -p ~/breakfix/terraform-12 && cd ~/breakfix/terraform-12
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

data "local_file" "seed" {
  filename = "${path.module}/seed.json"
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "seed = ${jsondecode(data.local_file.seed.content).id}\n"
}

# Same incident class: wrong path → missing remote state / empty outputs.
# data "terraform_remote_state" "net" {
#   backend = "local"
#   config  = { path = "${path.module}/../network/terraform.tfstate" }
# }
```

### file: seed.json.example

```json
{ "id": "seed-1" }
```

## Expected Failure

```bash
terraform init
terraform plan
```

```
Error: Invalid function argument

Invalid value for "filename" parameter: no file exists at
.../seed.json; this function works only with files that already
exist on disk.
```

(Exact wording varies by provider version; the filename is the tell.)

## Expected Outcome

```bash
cp seed.json.example seed.json
terraform plan
# Plan: 1 to add ...

terraform apply -auto-approve
cat generated/app.conf
# seed = seed-1
```

## Hints

### Hint 1 — Data sources do not create the object

`data.local_file` reads a file that must already exist. `data.aws_ami` looks
up an AMI that must already exist. If the producer is another Terraform
root, that root must have been applied (and the backend/key must be right).

### Hint 2 — Example files are not the file

`seed.json.example` is documentation. Terraform will not guess it. Either
commit `seed.json`, generate it in CI **before** plan, or take the value as
a variable.

## Solution

Put the real file where the data source looks:

```bash
cp seed.json.example seed.json
terraform plan
```

For remote state, print the backend key/workspace the **producer** used and
copy them into `data.terraform_remote_state`. Missing output names mean the
producer never `output`'d them — that is lab 05, in another root.

- **Data is a read at plan time.** Missing object = hard error (or empty
  remote-state outputs if you mis-point the backend).
- **`.example` files are not inputs.**
- **Do not `try()`-away a missing seed** in production; you will apply with
  empty config and call it success.
