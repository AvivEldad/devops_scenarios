# The instance nobody can reach

## Briefing

A colleague built a web server in a fresh VPC and went on holiday. The instance is
`running`, the status checks are `2/2 passed`, and the console shows nothing wrong.

SSH hangs until it times out. So does HTTP. There is no "connection refused", no
error, no log entry anywhere — just silence.

A connection to an EC2 instance has to survive four independent layers, and this one
is broken at three of them. Because they all produce the identical symptom, you
cannot tell how much progress you are making until the last one is fixed. That is the
skill this scenario builds: checking the path in a fixed order instead of guessing.

> **You bring the AWS account.** This creates a VPC, subnet, internet gateway,
> security group and one `t3.micro` instance. That instance costs money unless you are
> in the free tier, so **run the teardown when you finish**. Use a sandbox account.

## Your Task

1. Run the setup and confirm the instance is unreachable.
2. Diagnose each layer in order, without changing anything until you have a theory.
3. Fix all faults, reach the web server over HTTP, and connect over SSH.
4. Tear it all down.

Do not fix it by opening everything to the world. SSH must be restricted to your own
IP address.

```bash
mkdir -p ~/breakfix/aws-02 && cd ~/breakfix/aws-02
aws sts get-caller-identity
```

## Starter Files

### file: setup.sh

```bash
#!/usr/bin/env bash
# Builds a VPC and an unreachable instance. Three faults are intentional.
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
NAME="breakfix-net"

echo "region=$REGION"

VPC=$(aws ec2 create-vpc --cidr-block 10.50.0.0/16 --region "$REGION" \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$NAME}]" \
  --query Vpc.VpcId --output text)

SUBNET=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 10.50.1.0/24 --region "$REGION" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$NAME}]" \
  --query Subnet.SubnetId --output text)

IGW=$(aws ec2 create-internet-gateway --region "$REGION" \
  --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$NAME}]" \
  --query InternetGateway.InternetGatewayId --output text)
aws ec2 attach-internet-gateway --vpc-id "$VPC" --internet-gateway-id "$IGW" --region "$REGION"

# FAULT 1: a route table is created but no default route to the IGW is added
RTB=$(aws ec2 create-route-table --vpc-id "$VPC" --region "$REGION" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$NAME}]" \
  --query RouteTable.RouteTableId --output text)
aws ec2 associate-route-table --route-table-id "$RTB" --subnet-id "$SUBNET" --region "$REGION" >/dev/null

# FAULT 2: a security group with egress only, no inbound rules at all
SG=$(aws ec2 create-security-group --group-name "$NAME-sg" \
  --description "breakfix lab" --vpc-id "$VPC" --region "$REGION" \
  --query GroupId --output text)

KEY="$NAME-key"
aws ec2 delete-key-pair --key-name "$KEY" --region "$REGION" 2>/dev/null || true
aws ec2 create-key-pair --key-name "$KEY" --region "$REGION" \
  --query KeyMaterial --output text > "$KEY.pem"
chmod 600 "$KEY.pem"

AMI=$(aws ssm get-parameters \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --region "$REGION" --query 'Parameters[0].Value' --output text)

cat > userdata.sh <<'EOF'
#!/bin/bash
dnf install -y nginx
echo "breakfix web server is alive" > /usr/share/nginx/html/index.html
systemctl enable --now nginx
EOF

# FAULT 3: launched without a public IP address
INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --key-name "$KEY" --subnet-id "$SUBNET" --security-group-ids "$SG" \
  --user-data file://userdata.sh --region "$REGION" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text)

cat > env.sh <<EOF
export REGION=$REGION
export VPC=$VPC
export SUBNET=$SUBNET
export IGW=$IGW
export RTB=$RTB
export SG=$SG
export INSTANCE=$INSTANCE
export KEY=$KEY
EOF

echo "waiting for the instance to run..."
aws ec2 wait instance-running --instance-ids "$INSTANCE" --region "$REGION"

echo
echo "created. source env.sh to load the ids."
cat env.sh
```

### file: teardown.sh

```bash
#!/usr/bin/env bash
# Deletes everything the setup created. Run this when you finish.
set -uo pipefail
source ./env.sh

aws ec2 terminate-instances --instance-ids "$INSTANCE" --region "$REGION" >/dev/null
aws ec2 wait instance-terminated --instance-ids "$INSTANCE" --region "$REGION"

aws ec2 delete-security-group --group-id "$SG" --region "$REGION"
aws ec2 detach-internet-gateway --internet-gateway-id "$IGW" --vpc-id "$VPC" --region "$REGION"
aws ec2 delete-internet-gateway --internet-gateway-id "$IGW" --region "$REGION"
aws ec2 delete-subnet --subnet-id "$SUBNET" --region "$REGION"
aws ec2 delete-route-table --route-table-id "$RTB" --region "$REGION"
aws ec2 delete-vpc --vpc-id "$VPC" --region "$REGION"
aws ec2 delete-key-pair --key-name "$KEY" --region "$REGION"

rm -f "$KEY.pem" env.sh userdata.sh
echo "teardown complete"
```

## Expected Failure

```bash
bash setup.sh
source env.sh
```

The instance looks perfect:

```bash
aws ec2 describe-instance-status --instance-ids "$INSTANCE" --region "$REGION" \
  --query 'InstanceStatuses[0].{State:InstanceState.Name,Sys:SystemStatus.Status,Inst:InstanceStatus.Status}'
# { "State": "running", "Sys": "ok", "Inst": "ok" }
```

And there is nothing to connect to:

```bash
aws ec2 describe-instances --instance-ids "$INSTANCE" --region "$REGION" \
  --query 'Reservations[0].Instances[0].PublicIpAddress'
# null
```

No public IP at all. Even if you had one, both other layers would still block you.
Every attempt produces the same unhelpful silence:

```
ssh: connect to host ... port 22: Operation timed out
curl: (28) Failed to connect to ... port 80 after 75002 ms
```

A **timeout** means packets are being dropped, which points at security groups, NACLs
or routing. Connection **refused** would mean packets arrived and nothing was
listening — a different problem entirely. Learning to read that difference saves hours.

## Expected Outcome

Both services are reachable, and access is scoped, not wide open.

The instance has a public IP:

```bash
source env.sh
IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE" --region "$REGION" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "$IP"
# an address, not None
```

HTTP works from your machine:

```bash
curl -s --max-time 10 "http://$IP"
# breakfix web server is alive
```

SSH works:

```bash
ssh -i "$KEY.pem" -o StrictHostKeyChecking=no ec2-user@"$IP" 'hostname; systemctl is-active nginx'
# ip-10-50-1-xxx.eu-west-1.compute.internal
# active
```

The route to the internet gateway exists:

```bash
aws ec2 describe-route-tables --route-table-ids "$RTB" --region "$REGION" \
  --query 'RouteTables[0].Routes[?DestinationCidrBlock==`0.0.0.0/0`].GatewayId' --output text
# igw-xxxxxxxx
```

SSH is restricted to your address only — this is required, not optional:

```bash
aws ec2 describe-security-groups --group-ids "$SG" --region "$REGION" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text
# your.ip.add.ress/32     -- must NOT be 0.0.0.0/0
```

HTTP may be open to the world, since that is the point of a web server:

```bash
aws ec2 describe-security-groups --group-ids "$SG" --region "$REGION" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`80`].IpRanges[].CidrIp' --output text
# 0.0.0.0/0
```

Then tear down and confirm nothing is left running:

```bash
bash teardown.sh
aws ec2 describe-instances --instance-ids "$INSTANCE" --region "$REGION" \
  --query 'Reservations[0].Instances[0].State.Name' --output text
# terminated
```

## Hints

### Hint 1 — Check the four layers in a fixed order

Work outside-in and stop at the first thing that is wrong:

| Layer | Question | Command |
|---|---|---|
| 1. Address | Does it have a public IP? | `describe-instances` → `PublicIpAddress` |
| 2. Routing | Does the subnet route `0.0.0.0/0` to an internet gateway? | `describe-route-tables` |
| 3. NACL | Does the subnet NACL allow the traffic both ways? | `describe-network-acls` |
| 4. Security group | Is there an inbound rule for the port? | `describe-security-groups` |

Then, and only then, the instance itself: is the process listening, is the host
firewall open. Doing this in order is what stops you from randomly editing security
groups for an hour.

### Hint 2 — A subnet is only public if it routes to an IGW

Attaching an internet gateway to the VPC does nothing on its own. The subnet's route
table needs an explicit route:

```bash
aws ec2 describe-route-tables --route-table-ids "$RTB" --region "$REGION" \
  --query 'RouteTables[0].Routes'
```

You will see only the local `10.50.0.0/16` route. That is the definition of a private
subnet, regardless of what the gateway is attached to.

```bash
aws ec2 create-route --route-table-id "$RTB" \
  --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW" --region "$REGION"
```

### Hint 3 — Security groups are stateful and deny by default

A new security group has **no inbound rules** and allows all outbound. No inbound
rules means every inbound connection attempt is dropped silently — hence the timeout.

Stateful means you only need the inbound rule: the reply traffic for an allowed
inbound connection is permitted automatically, and you never write egress rules for
return traffic.

```bash
MYIP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 22 --cidr "$MYIP/32" --region "$REGION"
```

### Hint 4 — Public IP assignment happens at launch

`PublicIpAddress` is null and you cannot simply add one to a running instance in this
configuration. Two ways forward:

Allocate an Elastic IP and associate it, which works on the existing instance:

```bash
ALLOC=$(aws ec2 allocate-address --domain vpc --region "$REGION" --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" --region "$REGION"
```

Or set the subnet to auto-assign and relaunch:

```bash
aws ec2 modify-subnet-attribute --subnet-id "$SUBNET" --map-public-ip-on-launch --region "$REGION"
```

If you allocate an Elastic IP, remember it in teardown — a **released instance with a
retained Elastic IP still bills you**, because AWS charges for unattached addresses.

### Hint 5 — Rule out the layer that is probably fine

The default network ACL allows all traffic in both directions, so it is usually not
your problem — but confirm rather than assume, because a custom NACL denies
everything by default and NACLs are **stateless**, meaning you need matching rules for
the return traffic on ephemeral ports (1024-65535).

```bash
aws ec2 describe-network-acls --region "$REGION" \
  --filters "Name=association.subnet-id,Values=$SUBNET" \
  --query 'NetworkAcls[0].Entries'
```

Checking and eliminating a layer is progress. Skipping it is how you end up back here
in an hour.

## Solution

Three faults, one at each of three layers, all producing the same timeout.

```bash
source env.sh
MYIP=$(curl -s https://checkip.amazonaws.com)
echo "your address: $MYIP"
```

**Fault 1 — no route to the internet gateway.** The subnet was private.

```bash
aws ec2 create-route --route-table-id "$RTB" \
  --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW" --region "$REGION"
```

**Fault 2 — the security group has no inbound rules.**

```bash
aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 22 --cidr "$MYIP/32" --region "$REGION"

aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 80 --cidr 0.0.0.0/0 --region "$REGION"
```

**Fault 3 — no public IP.** Attach an Elastic IP to the running instance.

```bash
ALLOC=$(aws ec2 allocate-address --domain vpc --region "$REGION" --query AllocationId --output text)
echo "export ALLOC=$ALLOC" >> env.sh
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" --region "$REGION"

IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE" --region "$REGION" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
```

Verify:

```bash
curl -s --max-time 10 "http://$IP"
ssh -i "$KEY.pem" -o StrictHostKeyChecking=no ec2-user@"$IP" 'systemctl is-active nginx'
```

Add the Elastic IP to your teardown before you forget:

```bash
aws ec2 disassociate-address --association-id \
  "$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --region "$REGION" \
     --query 'Addresses[0].AssociationId' --output text)" --region "$REGION"
aws ec2 release-address --allocation-id "$ALLOC" --region "$REGION"
bash teardown.sh
```

The distinctions worth carrying into every future network problem:

- **Timeout versus refused.** Timeout means packets were dropped — suspect security
  groups, NACLs, routing, or a missing address. Refused means packets arrived and
  nothing was listening — suspect the application or the host firewall. This single
  observation eliminates half the search space before you run any command.
- **Security groups are stateful; NACLs are stateless.** With a security group you
  write one inbound rule and replies flow. With a NACL you must allow the outbound
  ephemeral port range too, which is the classic reason a "correct" custom NACL still
  blocks traffic.
- **Security groups can reference other security groups** as a source, which is far
  better than CIDR blocks for internal traffic — `--source-group sg-web` for the
  database means the rule keeps working as instances come and go.
- **An IGW attachment is not connectivity.** A subnet is public only if its route
  table has a `0.0.0.0/0` route to that gateway, and that is the definition worth
  memorising.

For real environments, note that SSH open even to your own IP is a design choice
worth avoiding: AWS Systems Manager Session Manager gives shell access with no
inbound rules and no key pair at all.

## What You Learned

Three faults, one symptom, no error messages. You could have spent an hour editing
the security group — a completely reasonable first guess — and made zero observable
progress, because two other layers were also broken.

That is why the ordered checklist beats intuition for network problems. Address,
route, NACL, security group, then the host. Each check takes seconds, each one either
finds a fault or eliminates a layer, and you always know how far you have got. On a
system where every failure looks identical from the outside, a method you can trust
is worth more than any individual piece of knowledge.
