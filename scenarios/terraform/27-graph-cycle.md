# Cycle: each file points at the other

## Briefing

`terraform plan` stops with `Error: Cycle`. Two `local_file` resources
interpolate each other's attributes. The graph is a loop; Terraform will
not pick an order.

Breaking it is almost always: **use a value that does not come from the
other resource** (a `local`, a variable, a `path.module` string), not a
new `depends_on` on the same loop.

## Your Task

- Run plan and read the cycle members.
- Remove the mutual references.
- Apply so both files exist and mention each other's **paths**, which you
  already know statically.

```bash
mkdir -p ~/breakfix/terraform-27 && cd ~/breakfix/terraform-27
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
  filename = "${path.module}/generated/app.conf"
  content  = "peer = ${local_file.peer.filename}\n"
}

resource "local_file" "peer" {
  filename = "${path.module}/generated/peer.conf"
  content  = "peer = ${local_file.app.filename}\n"
}
```

## Expected Failure

```bash
terraform init
terraform plan
```

```
Error: Cycle: local_file.app, local_file.peer
```

`terraform graph` (if you generate it) shows a two-node loop.

## Expected Outcome

```bash
terraform plan
# Plan: 2 to add ...

terraform apply -auto-approve
cat generated/app.conf generated/peer.conf
```

Each file contains the other's path. No cycle.

## Hints

### Hint 1 — A reference is an edge

`${local_file.peer.filename}` means "app after peer". The reverse edge
closes the cycle. `depends_on = [local_file.peer]` on both is the same
loop, louder.

### Hint 2 — Filenames here are not computed

`"${path.module}/generated/app.conf"` is known before any apply. Put it in
`locals` and both resources can read the local. You only need a resource
reference when the value is **actually** produced by that resource (an
id, a password, a DHCP address).

## Solution

```hcl
locals {
  app_path  = "${path.module}/generated/app.conf"
  peer_path = "${path.module}/generated/peer.conf"
}

resource "local_file" "app" {
  filename = local.app_path
  content  = "peer = ${local.peer_path}\n"
}

resource "local_file" "peer" {
  filename = local.peer_path
  content  = "peer = ${local.app_path}\n"
}
```

If one value **must** come from a resource, make the graph a line: create
A, then B that reads A. A `data` source that reads an object **already
in the world** (not this apply) can also break a bootstrap cycle.

- **Cycle members are printed in the error.** Start there.
- **`depends_on` cannot cut a data cycle** you still interpolate.
- **Static paths belong in `locals`**, not in cross-resource attributes.
