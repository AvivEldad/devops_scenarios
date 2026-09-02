# `create_before_destroy` plus a name that can only exist once

## Briefing

`lifecycle { create_before_destroy = true }` is the right fix for a
zero-downtime replacement **when the new object can exist beside the old
one**. It is the wrong fix when the physical name is unique: IAM role name,
load balancer name, or here a lock file path that the create provisioner
refuses to occupy twice.

Replacement tries to create first, hits "already exists", and you are stuck
with the old object and a failed apply.

## Your Task

- Apply release `1`.
- Bump to `2` so the `null_resource` replaces.
- Watch create-before-destroy fail on the unique path.
- Make replacement succeed (name_prefix / unique filename, or
  destroy-then-create).

```bash
mkdir -p ~/breakfix/terraform-21 && cd ~/breakfix/terraform-21
```

## Starter Files

### file: main.tf

```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

variable "release" {
  type    = string
  default = "1"
}

resource "null_resource" "endpoint" {
  triggers = {
    release = var.release
  }

  lifecycle {
    create_before_destroy = true
  }

  provisioner "local-exec" {
    command = "mkdir -p generated && test ! -e generated/app.lock && echo ${var.release} > generated/app.lock"
  }

  provisioner "local-exec" {
    when    = destroy
    command = "rm -f generated/app.lock"
  }
}
```

## Expected Failure

```bash
terraform init
terraform apply -auto-approve
terraform apply -auto-approve -var='release=2'
```

```
Error: local-exec provisioner error
test: generated/app.lock: file exists
```

Create ran while the old resource still held `app.lock`. Destroy never ran.

## Expected Outcome

A second apply with `release=2` succeeds. Either:

- the lock path includes the release (two names can coexist), or
- `create_before_destroy` is removed so destroy clears the unique name
  first.

```bash
terraform apply -auto-approve -var='release=2'
cat generated/app.lock
# 2
```

## Hints

### Hint 1 — CBD needs two identities at once

AWS: `name_prefix` instead of `name`. TLS/local: put a nonce in the
filename. If the API (or `test ! -e`) forbids duplicates, CBD cannot work.

### Hint 2 — Changing `triggers` replaces `null_resource`

That is what forces the new create. Combined with CBD you get overlap on
purpose — overlap is the feature that blew up here.

## Solution

Unique names, **or** destroy first:

```hcl
provisioner "local-exec" {
  command = "mkdir -p generated && echo ${var.release} > generated/app-${var.release}.lock"
}
```

```hcl
lifecycle {
  # create_before_destroy = true   # omit when the name is a singleton
}
```

On AWS the usual pattern is `name_prefix = "app-"` plus CBD, not
`name = "app"`.

- **CBD + unique `name` = collision.** This is why ALB / IAM replacements
  fail with EntityAlreadyExists.
- **`name_prefix` exists for this.**
- **Singleton locks should destroy-then-create**, with an accepted gap.
