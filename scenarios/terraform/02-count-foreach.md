# Renaming one item destroys five resources

## Briefing

Your team manages tenant configuration with Terraform. Six tenants, one resource
each, driven by a list in a variable.

A tenant churned, so someone removed them from the list and opened a pull request.
The plan says:

```
Plan: 5 to add, 0 to change, 6 to destroy.
```

Removing one item destroys and recreates everything. On these local files that is
merely alarming. The same configuration pattern applied to databases, EBS volumes or
IAM users is how a routine change becomes an outage.

> Uses only the `local` provider. Nothing is created in any cloud.

## Your Task

Reproduce the destructive plan, then fix the addressing so that removing one item
affects only that item.

1. Apply the initial configuration and inspect the resource addresses in state.
2. Remove the second tenant and observe the plan.
3. Change the configuration so the same removal touches exactly one resource.
4. Migrate the **existing state** to the new addressing without destroying anything.

The last step is the real exercise. Anyone can change `count` to `for_each`; doing it
to a live system without a destroy is the part that matters.

```bash
mkdir -p ~/breakfix/terraform-02 && cd ~/breakfix/terraform-02
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

variable "tenants" {
  description = "Tenants to provision configuration for"
  type = list(object({
    name  = string
    tier  = string
    quota = number
  }))

  default = [
    { name = "acme", tier = "gold", quota = 100 },
    { name = "globex", tier = "silver", quota = 50 },
    { name = "initech", tier = "gold", quota = 100 },
    { name = "umbrella", tier = "bronze", quota = 10 },
    { name = "wonka", tier = "silver", quota = 50 },
    { name = "stark", tier = "gold", quota = 200 },
  ]
}

resource "local_file" "tenant_config" {
  count = length(var.tenants)

  filename = "${path.module}/tenants/${var.tenants[count.index].name}.conf"

  content = <<-EOT
    tenant = ${var.tenants[count.index].name}
    tier   = ${var.tenants[count.index].tier}
    quota  = ${var.tenants[count.index].quota}
  EOT
}

output "tenant_files" {
  value = [for f in local_file.tenant_config : f.filename]
}
```

## Expected Failure

Apply the initial state:

```bash
terraform init
terraform apply -auto-approve
ls tenants/
# acme.conf  globex.conf  initech.conf  stark.conf  umbrella.conf  wonka.conf
```

Look at how the resources are addressed:

```bash
terraform state list
```

```
local_file.tenant_config[0]
local_file.tenant_config[1]
local_file.tenant_config[2]
local_file.tenant_config[3]
local_file.tenant_config[4]
local_file.tenant_config[5]
```

The identity of each resource is its **position in the list**. Now remove `globex`,
the second entry, from the `default` list in `main.tf` and plan:

```bash
terraform plan
```

```
  # local_file.tenant_config[1] must be replaced
  -/+ resource "local_file" "tenant_config" {
      ~ filename = "./tenants/globex.conf" -> "./tenants/initech.conf" # forces replacement
  # local_file.tenant_config[2] must be replaced
      ~ filename = "./tenants/initech.conf" -> "./tenants/umbrella.conf" # forces replacement
  # ... and so on for every index after the removal
  # local_file.tenant_config[5] will be destroyed

Plan: 5 to add, 0 to change, 6 to destroy.
```

Every tenant after the removed one shifts down by one index, so Terraform sees each
position as having changed identity. Five unrelated tenants get destroyed and
recreated because of an edit to a different tenant.

## Expected Outcome

Removing one tenant affects exactly one resource, and migrating to the new addressing
destroys nothing.

State is keyed by tenant name rather than position:

```bash
terraform state list
```

```
local_file.tenant_config["acme"]
local_file.tenant_config["globex"]
local_file.tenant_config["initech"]
local_file.tenant_config["stark"]
local_file.tenant_config["umbrella"]
local_file.tenant_config["wonka"]
```

The migration itself is a no-op — this is the critical check:

```bash
terraform plan
# No changes. Your infrastructure matches the configuration.
```

Now remove `globex` from the list and plan again:

```bash
terraform plan
```

```
  # local_file.tenant_config["globex"] will be destroyed

Plan: 0 to add, 0 to change, 1 to destroy.
```

Exactly one destroy, zero adds, zero replacements. Apply and confirm the other five
files were never touched:

```bash
ls -l --time-style=+%H:%M:%S tenants/
# five files, all with their ORIGINAL timestamps
```

Adding a tenant is equally surgical:

```bash
# add { name = "hooli", tier = "bronze", quota = 25 }
terraform plan
# Plan: 1 to add, 0 to change, 0 to destroy.
```

And the output still works:

```bash
terraform output tenant_files
```

Clean up:

```bash
terraform destroy -auto-approve
```

## Hints

### Hint 1 — Understand what the index means

With `count`, a resource's address in state is `resource.name[N]` where `N` is a
position. Terraform has no idea that position 1 "means" globex; it only knows that
whatever is at position 1 now has different attributes than before.

With `for_each`, the address is `resource.name["key"]`, and the key is chosen by you.
Remove an entry and every other key keeps its identity untouched.

The rule: use `count` for genuinely interchangeable, identical instances (three
replicas of the same thing), and `for_each` whenever the items have distinct
identities. Almost everything real is the second case.

### Hint 2 — for_each needs a map or a set of strings

`var.tenants` is a list of objects, which `for_each` will not accept directly. Two
options:

Convert with a comprehension, keying by name:

```hcl
for_each = { for t in var.tenants : t.name => t }
```

Then `each.key` is the tenant name and `each.value` is the whole object.

Or change the variable type to a map, which is arguably the better fix because it
makes duplicate names impossible:

```hcl
type = map(object({ tier = string, quota = number }))
```

The keys must be known at plan time. Deriving them from another resource's computed
attribute causes the "Invalid for_each argument" error you will eventually meet.

### Hint 3 — Migrate the state, do not recreate

After switching to `for_each`, a plan will show six destroys and six creates, because
`local_file.tenant_config[0]` and `local_file.tenant_config["acme"]` are different
addresses for the same object.

Two ways to fix that, and both are worth knowing:

`moved` blocks, which are declarative, reviewable, and belong in the pull request:

```hcl
moved {
  from = local_file.tenant_config[0]
  to   = local_file.tenant_config["acme"]
}
```

Or `terraform state mv`, which is imperative and immediate:

```bash
terraform state mv 'local_file.tenant_config[0]' 'local_file.tenant_config["acme"]'
```

### Hint 4 — Verify with plan before you trust it

After the migration, `terraform plan` must report **no changes**. That is your proof
that every state address now matches a configuration address.

If any resource still shows as create-or-destroy, one mapping is wrong. Compare
`terraform state list` against the addresses in the plan output.

Back up first: `cp terraform.tfstate terraform.tfstate.backup-manual`. Terraform keeps
its own backup, but with a remote backend and a team involved you want your own.

## Solution

The fault is that `count` makes list position the resource identity, so any insertion
or removal renumbers everything after it.

### The corrected `main.tf`

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

variable "tenants" {
  description = "Tenants to provision configuration for, keyed by tenant name"

  type = map(object({
    tier  = string
    quota = number
  }))

  default = {
    acme     = { tier = "gold", quota = 100 }
    globex   = { tier = "silver", quota = 50 }
    initech  = { tier = "gold", quota = 100 }
    umbrella = { tier = "bronze", quota = 10 }
    wonka    = { tier = "silver", quota = 50 }
    stark    = { tier = "gold", quota = 200 }
  }
}

resource "local_file" "tenant_config" {
  for_each = var.tenants

  filename = "${path.module}/tenants/${each.key}.conf"

  content = <<-EOT
    tenant = ${each.key}
    tier   = ${each.value.tier}
    quota  = ${each.value.quota}
  EOT
}

# One-time state migration from the count-based addressing.
# Safe to leave in place; delete once every environment has applied it.
moved {
  from = local_file.tenant_config[0]
  to   = local_file.tenant_config["acme"]
}

moved {
  from = local_file.tenant_config[1]
  to   = local_file.tenant_config["globex"]
}

moved {
  from = local_file.tenant_config[2]
  to   = local_file.tenant_config["initech"]
}

moved {
  from = local_file.tenant_config[3]
  to   = local_file.tenant_config["umbrella"]
}

moved {
  from = local_file.tenant_config[4]
  to   = local_file.tenant_config["wonka"]
}

moved {
  from = local_file.tenant_config[5]
  to   = local_file.tenant_config["stark"]
}

output "tenant_files" {
  value = { for k, f in local_file.tenant_config : k => f.filename }
}
```

Verify the migration is a no-op, then test the original change:

```bash
terraform plan
# Plan: 0 to add, 0 to change, 0 to destroy.
terraform apply -auto-approve
terraform state list

# now remove the globex line from the map
terraform plan
# Plan: 0 to add, 0 to change, 1 to destroy.
```

Why the map type is better than a list plus a comprehension: the map makes the key
part of the schema, so a duplicate tenant name is a configuration error rather than a
silent collision, and there is no intermediate expression to get wrong. When you
cannot change the input type, `{ for t in var.tenants : t.name => t }` is the
standard conversion.

A caution about `for_each` keys: they must be known during plan. Keying off something
computed — an ARN, a generated ID, a resource attribute — produces
"Invalid for_each argument: the for_each value depends on resource attributes that
cannot be determined until apply". Key off input data you control.

And on `moved` versus `state mv`: prefer `moved` blocks. They are code, so they get
reviewed, they run automatically in every environment and every CI pipeline, and they
cannot be forgotten by the person applying in staging. `state mv` is a manual
operation that has to be repeated identically per workspace, which is exactly the
kind of thing that gets done in production at 6 p.m. and skipped in disaster recovery.

## What You Learned

The plan output was the whole warning, and it was completely explicit: `6 to destroy`
for a change that removed one tenant. The skill is not detecting a subtle problem —
it is reading the plan carefully enough to notice, and refusing to apply until the
number matches your intent.

The design lesson is that `count` encodes identity as position, which is only correct
when the instances are genuinely interchangeable. Anything with a name, an owner or a
lifecycle of its own wants `for_each`. And when you migrate between them, `moved`
blocks let you change addressing without touching a single real resource.
