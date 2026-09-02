# The database password is in the CI log

## Briefing

`terraform apply` printed a generated password in the outputs block. The
pipeline archived `terraform output`. Slack has the value. Marking the
output `sensitive` is necessary and **not sufficient**: the password is
still plaintext in `terraform.tfstate`.

## Your Task

- Apply and show the password via `terraform output` and in the apply log.
- Mark the output sensitive and confirm the CLI redacts it.
- Prove the value is still in state. State what that means for remote state
  access and CI artefacts.

```bash
mkdir -p ~/breakfix/terraform-10 && cd ~/breakfix/terraform-10
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
  }
}

resource "random_password" "db" {
  length  = 16
  special = false
}

output "db_password" {
  value = random_password.db.result
}

output "db_password_length" {
  value = length(random_password.db.result)
}
```

## Expected Failure

```bash
terraform init
terraform apply -auto-approve
```

```
Outputs:

db_password = "kV8...."
db_password_length = 16
```

```bash
terraform output db_password
# still the plaintext
```

Anyone with CI logs has the secret.

## Expected Outcome

```bash
terraform apply -auto-approve
# db_password = <sensitive>

terraform output db_password
# still redacted

terraform output -raw db_password
# Terraform will show it: sensitive outputs are not gone, only hidden
```

```bash
grep -o '"result": "[^"]*"' terraform.tfstate
# the password is in state regardless of the output flag
```

## Hints

### Hint 1 — `sensitive = true` is a UI flag

It redacts CLI, most logs, and `terraform output` (without `-raw`). It does
not encrypt the value. Anyone who can `terraform output -raw` or read state
still has it.

### Hint 2 — State is a secret

`random_password`, `tls_private_key`, and provider-generated tokens all land
in state. Protect the backend (encryption, IAM, no public S3). Do not
publish `terraform.tfstate` as a build artefact.

## Solution

```hcl
output "db_password" {
  value     = random_password.db.result
  sensitive = true
}
```

That only fixes the log leak. Remaining controls:

- Encrypt remote state; restrict `s3:GetObject` / DynamoDB / local copies.
- Prefer a secret manager (SSM, Vault) as the source of truth if something
  other than Terraform must read the password.
- Never `echo $(terraform output -raw db_password)` in bash `-x` CI.

- **Sensitive outputs hide; they do not delete.**
- **`terraform output -raw` is an explicit reveal** — treat it like
  `cat`ing a key file.
- **If it is in state, it is a secret file.** Same handling as a `.pem`.
