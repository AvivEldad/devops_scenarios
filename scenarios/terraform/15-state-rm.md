# `state rm` made the next apply recreate the resource

## Briefing

Plan was noisy. Someone "fixed" it with `terraform state rm local_file.app`.
The file on disk stayed. State forgot it. The next apply is a **create**.
For a local file that overwrites. For a key pair or IAM user it mints a
**second** object and leaves the original unmanaged — or rotates a secret
you still depend on.

`state rm` unmanages. It does not delete the object, and it does not mean
"ignore this forever".

## Your Task

- Run setup (apply, then `state rm`).
- Inspect disk vs `terraform state list`.
- Restore management without inventing a duplicate (import, or `state push`
  of a backup), then get a clean plan.

```bash
mkdir -p ~/breakfix/terraform-15 && cd ~/breakfix/terraform-15
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
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

resource "tls_private_key" "ssh" {
  algorithm = "ED25519"
}

resource "local_file" "pem" {
  filename        = "${path.module}/generated/id_ed25519"
  content         = tls_private_key.ssh.private_key_openssh
  file_permission = "0600"
}
```

### file: setup.sh

```bash
#!/bin/bash
set -euo pipefail
terraform init -input=false
terraform apply -auto-approve
# The "fix":
terraform state rm local_file.pem
echo "state now:"
terraform state list
echo "disk still:"
ls -l generated/id_ed25519
```

## Expected Failure

```bash
chmod +x setup.sh && ./setup.sh
terraform plan
```

```
Plan: 1 to add, 0 to change, 0 to destroy.
```

The PEM still exists. Apply would write a new file from the **same** key
this time — or, if they also `state rm`'d `tls_private_key.ssh`, the next
apply generates a **new** key and overwrites `id_ed25519`.

## Expected Outcome

The file is back in state. Plan is empty. The key bytes did not change.

```bash
terraform state list
# tls_private_key.ssh
# local_file.pem

terraform plan
# No changes.
```

## Hints

### Hint 1 — `rm` from state ≠ `destroy`

`terraform destroy` deletes the object **and** the state entry. `state rm`
only drops the entry. The object becomes snowflake infrastructure.

### Hint 2 — Put it back with import, not apply

```bash
terraform import local_file.pem "$(pwd)/generated/id_ed25519"
```

Apply-as-create is how you rotate a key by accident.

## Solution

Import the existing file (and never `state rm` the private key unless you
intend to forget it):

```bash
terraform import local_file.pem "${PWD}/generated/id_ed25519"
terraform plan
```

If they removed `tls_private_key.ssh` too, do **not** apply. Restore state
from backup (`terraform state push` of the last good snapshot) or you will
issue a new key.

- **`state rm` is unmanage, not delete.** Next apply creates.
- **Take `state pull` backups** before any state surgery.
- **Noisy plans** are drift, moves, or lifecycle — not a reason to drop
  addresses.
