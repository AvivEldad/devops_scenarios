# The private key is in `terraform.tfstate`

## Briefing

You generated `random_password` and `tls_private_key` so "secrets are not in
git". They are in **state**, plaintext JSON. Anyone who can `terraform state
pull`, clone the local backend, or read the S3 object has the key.

Sensitive outputs hide the CLI. They do not scrub state. Decide what belongs
in Terraform versus a secret store.

## Your Task

- Apply and grep state for the password and the PEM.
- Mark outputs sensitive; grep again.
- Write a one-paragraph policy: what may stay in state, what should be
  SSM/Vault, how state is protected.

```bash
mkdir -p ~/breakfix/terraform-23 && cd ~/breakfix/terraform-23
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
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

resource "random_password" "db" {
  length  = 20
  special = false
}

resource "tls_private_key" "ssh" {
  algorithm = "ED25519"
}

resource "local_file" "pem" {
  filename        = "${path.module}/generated/id_ed25519"
  content         = tls_private_key.ssh.private_key_openssh
  file_permission = "0600"
}

output "db_password" {
  value = random_password.db.result
}

output "ssh_public" {
  value = tls_private_key.ssh.public_key_openssh
}
```

## Expected Failure

```bash
terraform init && terraform apply -auto-approve
grep -E 'private_key|result' terraform.tfstate | head
```

The password string and the `-----BEGIN OPENSSH PRIVATE KEY-----` block are
in the JSON. `terraform output` prints the password too.

## Expected Outcome

```hcl
output "db_password" {
  value     = random_password.db.result
  sensitive = true
}
```

```bash
grep BEGIN terraform.tfstate
# still hits: state is unchanged by the output flag
```

You have a written rule: state is encrypted at rest; PEM files are not CI
artefacts; rotate if state leaked.

## Hints

### Hint 1 — Provider attributes are stored in full

`random_password.result`, `tls_private_key.private_key_pem`, database
`master_password` in RDS: all in the resource instance object. There is no
`sensitive = true` on a resource that removes this.

### Hint 2 — Remote state encryption is necessary, not optional

S3 `encrypt`, KMS, tight IAM, no public buckets, no state in GitHub
Actions `upload-artifact`. Ephemeral resources (TF 1.10+) can keep some
values out of state; most teams still treat the backend as secret.

## Solution

Redact outputs, then handle the real copy:

```hcl
output "db_password" {
  value     = random_password.db.result
  sensitive = true
}

output "ssh_public" {
  value = tls_private_key.ssh.public_key_openssh
}
```

Policy that survives review:

- **OK in state:** public keys, hashes, ARNs, non-secret ids.
- **Sensitive but common in state:** generated passwords, TLS keys —
  backend must be secret, access logged.
- **Better elsewhere:** long-lived human secrets, API tokens someone
  pasted; write them to SSM/Vault and pass the **handle** into Terraform.
- **Never:** commit `terraform.tfstate`, `generated/id_ed25519`, or
  `terraform output -raw` into Slack.

- **State is a secret store you did not mean to build.**
- **`sensitive` is display-only.**
- **A leaked state file is a rotation event.**
