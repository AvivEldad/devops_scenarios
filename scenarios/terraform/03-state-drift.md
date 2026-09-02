# The plan wants to destroy production

## Briefing

Three things happened to this stack in the same week, all by different people:

- Someone edited a configuration file **by hand** on the server during an incident
  and never told anyone.
- Someone **renamed a resource** in the Terraform code to match a new naming standard.
- Someone created a resource **outside Terraform** because they needed it quickly.

Now `terraform plan` reports destroys on things that are working and creates on
things that already exist. The team is refusing to apply, and quite rightly, but the
stack is frozen until somebody reconciles it.

Your job is to make `terraform plan` report no changes without deleting or recreating
anything.

> Uses only the `local` provider, so "production" here is a set of files on your
> disk. The state operations are identical to the ones you would run against real
> infrastructure.

## Your Task

1. Run the setup script, which applies a stack and then introduces all three
   divergences.
2. Reconcile each one, choosing deliberately whether reality or code is correct.
3. Reach `No changes` with every original file still present and never recreated.

Verify by file timestamp that nothing was destroyed and recreated. That is the whole
point of the exercise — a plan that shows no changes because you deleted the evidence
is a failure.

```bash
mkdir -p ~/breakfix/terraform-03 && cd ~/breakfix/terraform-03
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

resource "local_file" "app_config" {
  filename        = "${path.module}/stack/app.conf"
  file_permission = "0644"

  content = <<-EOT
    service = payments
    workers = 4
    log_level = info
  EOT
}

resource "local_file" "db_config" {
  filename        = "${path.module}/stack/db.conf"
  file_permission = "0644"

  content = <<-EOT
    host = db.internal
    pool = 10
  EOT
}

output "managed_files" {
  value = [
    local_file.app_config.filename,
    local_file.db_config.filename,
  ]
}
```

### file: setup.sh

```bash
#!/usr/bin/env bash
# Apply the stack, then introduce three real-world divergences.
set -euo pipefail

terraform init -input=false >/dev/null
terraform apply -auto-approve >/dev/null
echo "stack applied:"
ls -l stack/

echo
echo "--- divergence 1: someone edited app.conf by hand during an incident ---"
cat > stack/app.conf <<'EOF'
service = payments
workers = 16
log_level = debug
EOF

echo "--- divergence 2: someone created a file outside terraform ---"
cat > stack/cache.conf <<'EOF'
backend = redis
ttl = 300
EOF
chmod 644 stack/cache.conf

echo "--- divergence 3: the db resource is about to be renamed in code ---"
echo "   (you will rename local_file.db_config to local_file.database_config)"

echo
echo "current state:"
terraform state list
```

## Expected Failure

```bash
bash setup.sh
```

Now apply divergence 3 by renaming the resource in `main.tf` from
`local_file.db_config` to `local_file.database_config` (change the label only, not
the arguments), and add a resource for the cache file someone created by hand:

```hcl
resource "local_file" "cache_config" {
  filename        = "${path.module}/stack/cache.conf"
  file_permission = "0644"

  content = <<-EOT
    backend = redis
    ttl = 300
  EOT
}
```

Then plan:

```bash
terraform plan
```

```
  # local_file.app_config must be replaced
  -/+ resource "local_file" "app_config" {
      ~ content = <<-EOT
          - workers = 4
          + workers = 16
        EOT # forces replacement

  # local_file.cache_config will be created
  + resource "local_file" "cache_config" { ... }

  # local_file.database_config will be created
  + resource "local_file" "database_config" { ... }

  # local_file.db_config will be destroyed
  - resource "local_file" "db_config" { ... }

Plan: 3 to add, 0 to change, 2 to destroy.
```

Three distinct problems in one plan:

- `app_config` shows drift — the file on disk no longer matches state, and for this
  resource type any content change forces replacement.
- `db_config` destroy plus `database_config` create is a **rename**, not a
  replacement. The object is the same; only its address changed.
- `cache_config` create would fail or overwrite, because the file already exists and
  Terraform does not know about it.

Applying this plan would delete a working database config and clobber a file someone
else created.

## Expected Outcome

`terraform plan` reports no changes, and nothing was destroyed along the way.

```bash
terraform plan
# No changes. Your infrastructure matches the configuration.
```

State contains the new resource address and the adopted resource:

```bash
terraform state list
```

```
local_file.app_config
local_file.cache_config
local_file.database_config
```

`local_file.db_config` must be gone from state, while the file it manages survives:

```bash
terraform state list | grep -c '^local_file.db_config$'
# 0

cat stack/db.conf
# host = db.internal
# pool = 10
```

The hand-edited values are preserved, because that edit was a real operational
decision:

```bash
grep -E 'workers|log_level' stack/app.conf
# workers = 16
# log_level = debug
```

Nothing was recreated. Compare inode numbers before and after — they must not change:

```bash
stat -c '%n %i' stack/*.conf
# record these before your reconciliation and compare after
```

The externally created file is now managed:

```bash
terraform state show local_file.cache_config | head -3
```

And a full cycle is stable:

```bash
terraform apply -auto-approve
terraform plan
# No changes.
```

## Hints

### Hint 1 — Classify each difference before touching anything

Every line in that plan is one of three situations, and each has a different remedy:

| Situation | What it means | Remedy |
|---|---|---|
| Drift | Reality changed, state is stale | Update code to match reality, or apply to overwrite reality |
| Rename | Same object, new address in code | Move the state entry |
| Unmanaged | Real object with no state entry | Import it |

Write out which of the three each item is before you run a command. Reconciling state
with the wrong tool is how people delete production.

### Hint 2 — Refresh shows you the drift explicitly

```bash
terraform plan -refresh-only
```

This asks "what has changed in reality since state was written?" without proposing
any configuration changes. It is the safest way to see drift, and
`terraform apply -refresh-only` accepts the real values into state without touching
resources.

For `app.conf`, decide deliberately: was the hand edit correct? If yes, the *code* is
wrong and must be updated to `workers = 16`. If no, applying will restore the file.
This is a judgement call, not a technical one — and in a real incident you go and ask
the person who made the edit.

### Hint 3 — A rename is a state move, never a destroy

`db_config` to `database_config` is purely an address change. Use a `moved` block:

```hcl
moved {
  from = local_file.db_config
  to   = local_file.database_config
}
```

or the imperative equivalent:

```bash
terraform state mv local_file.db_config local_file.database_config
```

Prefer the `moved` block: it is reviewable in the pull request and runs automatically
in every environment.

### Hint 4 — Adopt the unmanaged resource with import

Terraform 1.5 and later support a declarative `import` block:

```hcl
import {
  to = local_file.cache_config
  id = "./stack/cache.conf"
}
```

Run `terraform plan` and check the result carefully: if your resource block does not
match the real object exactly, the plan will show changes or a replacement. Adjust
the configuration until the import plans clean, then apply.

The older imperative form is `terraform import local_file.cache_config ./stack/cache.conf`.
Note the ID format is provider-specific — an S3 bucket imports by name, an EC2
instance by instance ID, an IAM role by role name. Always check the resource's
documentation for the expected ID.

### Hint 5 — Back up state, and know what -target is for

```bash
cp terraform.tfstate terraform.tfstate.pre-reconcile
```

With a remote backend, pull a copy: `terraform state pull > backup.tfstate`.

You may also want to reconcile one resource at a time and check the plan between
steps. `terraform plan -target=local_file.app_config` narrows the operation. Treat
`-target` as a surgical debugging tool rather than a habit — it applies a partial
configuration, and routine use leaves your state permanently half-applied.

## Solution

Handle the three divergences in order, verifying with `plan` between each step.

**Step 0 — back up and record identities.**

```bash
cp terraform.tfstate terraform.tfstate.pre-reconcile
stat -c '%n %i' stack/*.conf > /tmp/inodes.before
```

**Step 1 — the rename.** Add a `moved` block; this is a pure state operation.

```hcl
moved {
  from = local_file.db_config
  to   = local_file.database_config
}
```

**Step 2 — adopt the unmanaged file.** Add an `import` block alongside the resource.

```hcl
import {
  to = local_file.cache_config
  id = "./stack/cache.conf"
}
```

**Step 3 — resolve the drift.** The hand edit raised workers and enabled debug
logging during an incident, and it is currently keeping the service healthy, so
reality wins. Update the code to match:

```hcl
resource "local_file" "app_config" {
  filename        = "${path.module}/stack/app.conf"
  file_permission = "0644"

  content = <<-EOT
    service = payments
    workers = 16
    log_level = debug
  EOT
}
```

The complete reconciled `main.tf`:

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

resource "local_file" "app_config" {
  filename        = "${path.module}/stack/app.conf"
  file_permission = "0644"

  content = <<-EOT
    service = payments
    workers = 16
    log_level = debug
  EOT
}

resource "local_file" "database_config" {
  filename        = "${path.module}/stack/db.conf"
  file_permission = "0644"

  content = <<-EOT
    host = db.internal
    pool = 10
  EOT
}

resource "local_file" "cache_config" {
  filename        = "${path.module}/stack/cache.conf"
  file_permission = "0644"

  content = <<-EOT
    backend = redis
    ttl = 300
  EOT
}

moved {
  from = local_file.db_config
  to   = local_file.database_config
}

import {
  to = local_file.cache_config
  id = "./stack/cache.conf"
}

output "managed_files" {
  value = [
    local_file.app_config.filename,
    local_file.database_config.filename,
    local_file.cache_config.filename,
  ]
}
```

Apply and verify:

```bash
terraform plan
# Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.

terraform apply -auto-approve
terraform plan
# No changes. Your infrastructure matches the configuration.

terraform state list
stat -c '%n %i' stack/*.conf > /tmp/inodes.after
diff /tmp/inodes.before /tmp/inodes.after && echo "nothing was recreated"
```

Once every environment has applied, the `moved` and `import` blocks can be deleted —
they are one-time migrations, and `import` in particular will error on the next run
if the object is already in state under a different address.

The mental model underneath all of this: Terraform continuously compares three
things — your configuration, its state file, and the real world. State is a *cache*
of what Terraform believes it created, not the truth. Reconciliation is always about
which of the three you are choosing to correct:

- reality wrong, code right: `apply`
- reality right, code wrong: update the code, or `apply -refresh-only`
- state address wrong: `moved` or `state mv`
- state entry missing: `import`
- state entry should not exist: `terraform state rm` (removes from state, leaves the
  real object alone — the right tool when ownership moves to another team or module)

## What You Learned

Three ordinary human actions — an emergency edit, a rename, a quick manual creation —
combined into a plan that would have destroyed working infrastructure. None of the
three people did anything unreasonable, which is why drift is a permanent condition
of real systems rather than a mistake to be eliminated.

The professional skill is classification. Before running any state command, decide
whether you are looking at drift, a rename, or an unmanaged resource, because the
remedies are not interchangeable and using the wrong one is destructive. Then back up
state, work one resource at a time, and let `plan` confirm each step before you take
the next.
