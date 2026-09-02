# The server log has no request and the client got RST in the middle of TLS

## Briefing

Clients report `Connection reset by peer` during the handshake or after
the first HTTP bytes. The application access log is empty. tcpdump on the
app host never sees the ClientHello. tcpdump on the client shows SYN,
SYN-ACK, ClientHello, then an RST whose TTL/window/sequence does not
match the server's other packets.

A middlebox (IPS, "TLS firewall", carrier NAT, overzealous conntrack) is
injecting RST. The server is innocent. Restarting gunicorn does nothing.
The RST may be selective: SNI of `pastebin` or JA3 of a non-browser, or
payloads that look like a known exploit signature in a protocol the box
cannot parse.

You are not writing an evasion. You are proving the RST is not from your
process so you can call the right team with evidence.

## Your Task

- Capture on client and server for one 4-tuple.
- Show RST that the server did not send (TTL mismatch, unseen on server
  tap, or `ss` never left LISTEN/no socket).
- Identify the likely injector class (on-path firewall vs host iptables
  REJECT) and apply the control-plane fix (exception, disable inspect on
  that VIP, or stop sending the pattern the policy bans — e.g. HTTP/1.0
  to a filter that only allows 1.1).

## Starter Files

### file: ttl-notes.txt

```
# client capture
IP (ttl 64)  client > vip: S
IP (ttl 54)  vip    > client: S.
IP (ttl 64)  client > vip: P (ClientHello)
IP (ttl 57)  vip    > client: R              # TTL 57 != 54  -> not the same hop

# server capture (same time): no RST sent, no ClientHello received
```

### file: check.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "On the server during a failed curl:"
echo "  tcpdump -ni eth0 'tcp port 443 and host <client>'"
echo "  ss -tnp | grep <client>"
echo "If the client saw RST and the server saw nothing, the RST is injected."
```

## Expected Failure

```bash
curl -sv https://api.example/health
# * Connected
# * TLSv1.3 (OUT), TLS handshake, Client hello (1):
# * Recv failure: Connection reset by peer
# curl: (35) OpenSSL SSL_connect: Connection reset by peer

# journalctl -u api : no corresponding request
```

## Expected Outcome

Handshake completes and the app log shows the GET:

```bash
curl -sSI --connect-timeout 5 https://api.example/health
# HTTP/2 200

# client and server captures: no injected RST; TTL of SYN-ACK matches later packets
```

An exception exists for this VIP on the IPS, or the client uses a path
that is not inspected, with a ticket — not a "try curl -k".

## Hints

### Hint 1 — TTL and who saw the RST

If only the client sees RST, it was injected closer to the client than
your tap. If both see RST and `ss` on the server shows the socket sending
it, it is local (`iptables REJECT`, the process called `close`).

### Hint 2 — Sequence and window

Injected RSTs often have implausible TTL, window 0, or a sequence that
does not continue the SYN-ACK. Wireshark "TCP Analysis / RST" plus two
taps beats guessing.

## Solution

Attribute the RST, then change the device that sent it.

```bash
# two captures, same 4-tuple
tcpdump -w client.pcap -ni eth0 'host api.example and port 443'
tcpdump -w server.pcap -ni eth0 'host <client> and port 443'
# compare TTL of SYN-ACK vs RST
# host REJECT: iptables -L OUTPUT/INPUT -n -v ; nft list ruleset
# on-path: network/security team, IPS exception, or different egress
```

- **RST is not automatically your application.** Empty app logs plus RST
  in TLS is a middlebox until two taps say otherwise.
- **TTL mismatch is enough evidence** to stop bouncing the JVM.
- **`-k` does not stop an IPS RST.** This is not a certificate problem.
- **Do not "bypass" inspection with a homemade tunnel in production** —
  get a policy exception for the legitimate service.
