# S3 backend, no lock: last apply wins

## Briefing

`backend "s3"` has a bucket and key. There is no `dynamodb_table` and no
`use_lockfile`. Two pipelines applied at once. Both read serial N, both
wrote serial N+1. The slower one uploaded last. Resources the faster one
created vanished from state and became unmanaged.

You do not need AWS for this lab. The HCL is the incident. A second file
shows what "last writer wins" looks like in state.

## Your Task

- Read the backend block and list every locking field that is missing.
- Explain the race (two reads of the same serial).
- Write the corrected backend (DynamoDB and/or native S3 lockfile). Do not
  init against a real bucket.

```bash
mkdir -p ~/breakfix/terraform-22 && cd ~/breakfix/terraform-22
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

  # Incident config. Left commented so `init` stays local.
  # backend "s3" {
  #   bucket = "acme-tf-state"
  #   key    = "app/terraform.tfstate"
  #   region = "eu-west-1"
  #   # dynamodb_table = "acme-tf-locks"   # missing
  #   # use_lockfile   = true              # missing (TF 1.10+ S3 native lock)
  #   # encrypt        = true
  # }

  backend "local" {
    path = "terraform.tfstate"
  }
}

resource "local_file" "app" {
  filename = "${path.module}/generated/app.conf"
  content  = "ok\n"
}
```

### file: after-race.tfstate

```json
{
  "version": 4,
  "terraform_version": "1.5.0",
  "serial": 7,
  "lineage": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "outputs": {},
  "resources": [],
  "check_results": null
}
```

### file: NOTES.txt

```
Writer A: plan 3 to add, apply, created files, state serial 6→7 with 3 resources.
Writer B: started with serial 6 too (no lock). Apply wrote serial 7 with
only B's one resource. A's objects exist in the world, not in state.

Local backends lock with .terraform.tfstate.lock.info — that is why a
second local apply waits. S3 without DynamoDB/use_lockfile does not.
```

## Expected Failure

```bash
terraform init
# local lock is active here; the S3 block above would not lock
```

The failure is the review finding: production `backend "s3"` as
commented cannot serialise applies. `after-race.tfstate` is empty of
resources at serial 7 — the losing apply's view.

## Expected Outcome

Corrected S3 backend (still conceptual):

```hcl
backend "s3" {
  bucket         = "acme-tf-state"
  key            = "app/terraform.tfstate"
  region         = "eu-west-1"
  dynamodb_table = "acme-tf-locks"
  encrypt        = true
  use_lockfile   = true
}
```

You can describe the race in one sentence: two writers, same serial, last
`PutObject` wins.

## Hints

### Hint 1 — Local locking is not S3 locking

`Error acquiring the state lock` on a local backend means the lock **works**.
S3 state is just an object. Without DynamoDB conditional writes (or the
native lockfile), there is no mutex.

### Hint 2 — Serial is not a lock

`serial` increments on each write. It detects some stale pushes; it does
not stop two concurrent applies that both started at serial N.

## Solution

Enable a lock **before** the second pipeline exists:

- `dynamodb_table` with a partition key `LockID` (classic).
- Terraform 1.10+: `use_lockfile = true` (S3 object lock file). Using both
  during a migration is fine.
- `encrypt = true`, bucket policy, no public ACL.

If a race already happened: stop applies, `state pull` from the bucket,
compare to reality, `import` / `state mv` the missing objects, then lock.

- **Unlocked remote state is a split-brain waiting to happen.**
- **CI concurrency of 1 is not a lock** (a human laptop can still apply).
- **Empty state at a high serial** is a smell of last-writer-wins.
