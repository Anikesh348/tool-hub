# How I Put My Homelab on the Internet Without Exposing My Home Network

*Part 2 of **One Pi, One SSD, 48 Containers***

My private access setup worked nicely while the only user was me.

Tailscale made the Raspberry Pi feel local from my laptop and phone, even when I was not at home. The awkward part arrived when I wanted friends and family to use selected services too. “Install this VPN client and join my private device network first” is reasonable for my own machines. It is not the front door I wanted for everybody else.

The obvious alternative was router port forwarding. It was also the alternative I did not want. Opening a series of home-router ports would make my residential connection and the Pi itself part of the public boundary. Every new service would add another rule, another port and another chance to publish something I meant to keep private.

I wanted ordinary HTTPS links on the outside and no public service ports on the home router. That requirement eventually produced a longer request path than I expected: [Cloudflare DNS](#term:cloudflare-dns), a small public [VPS](#term:vps), [Caddy](#term:caddy), an encrypted [WireGuard](#term:wireguard) link and a custom [authentication gateway](#term:authentication-gateway).

The path is longer, but each piece has one job. That has made it much easier to reason about than a collection of unrelated port forwards.

## The requirement was simpler than the architecture

I wrote down the constraints before choosing the components:

- friends and family should open a normal domain in a browser;
- the public DNS record should never point to my home connection;
- the home router should not forward a public port to every application;
- different hostnames should reach different services on the Pi;
- HTTPS should be automatic rather than a certificate-renewal calendar event;
- administrative tools should have an authentication check before the application loads;
- losing the public path should not stop services from working on the LAN.

Tailscale still handles private access for my own devices. This new path solves a different problem: carefully selected public access for people who should not need to understand my network first.

## The public request path

At a high level, a request now moves through five boundaries:

![Public request path from Cloudflare DNS to a VPS, through Caddy and an authentication decision, across WireGuard to a service on the Raspberry Pi](assets/diagrams/public-request-path.svg)

*The VPS is the public edge. The Pi is reachable from it only across the private WireGuard network, and selected hostnames must pass an authentication decision before Caddy forwards them.*

| Boundary | Responsibility |
| --- | --- |
| Cloudflare | Authoritative DNS, with proxying enabled for selected records |
| VPS | The public machine that receives web traffic |
| Caddy | Hostname routing, HTTPS and reverse proxying |
| Authentication gateway | A policy check for selected services and roles |
| WireGuard | Encrypted private transport between the VPS and the Pi |
| Raspberry Pi | The actual application containers and persistent data |

The VPS has `10.90.0.1` inside the WireGuard network; the Pi has `10.90.0.2`. Those are private tunnel addresses, not public destinations. Caddy sends traffic to the Pi’s tunnel address and the appropriate application port.

That distinction matters. The domain resolves to the public edge, not to the house where the application runs.

## Cloudflare names the service, but it is not the service

Cloudflare is the authoritative DNS provider for `hostingfrompurva.xyz`. A hostname such as `hostingfrompurva.xyz` or one of its subdomains ultimately directs a request towards the VPS.

I use both Cloudflare DNS patterns. Some records resolve directly to the VPS; selected records use Cloudflare’s proxy. In neither case does the record point to the Pi or my home IP address.

Using Cloudflare for DNS is separate from using [Cloudflare Tunnel](#term:cloudflare-tunnel). I considered Tunnel because it also avoids inbound home-router ports. The architecture I settled on gives me an ordinary reverse proxy that I can inspect end to end, tune per hostname and use for different kinds of traffic without making the Pi the public endpoint.

DNS does not provide authentication, and hiding the home IP is not the same as securing an application. It only answers the first question: where should this hostname go?

For my setup, the answer is always the public edge.

## The VPS is deliberately boring

The VPS is not a second homelab. It is a small internet-facing machine with a narrow job: accept web requests, handle HTTPS, make an authentication decision where required and proxy approved traffic through WireGuard.

That is useful because a VPS has a stable public address and lives in a data centre designed to receive inbound traffic. My Pi remains on the home network, where its services can continue to use local storage and talk to each other without becoming individually public.

The trade-off is that I now operate another Linux machine. It needs updates, firewall rules, logs, certificate state and monitoring. If the VPS is unavailable, public access stops even though the applications may still be perfectly healthy at home.

That failure mode is acceptable to me. A VPS outage should inconvenience remote access, not take down Samba on my LAN or stop Jellyfin working on the television at home.

## WireGuard gives Caddy a private road home

The VPS and Pi share a WireGuard subnet. The VPS uses `wg0`; the Pi uses `wg1`. Each peer is allowed only the other tunnel address, and a persistent keepalive helps the connection remain usable through home-network address translation.

Once the tunnel is up, the VPS can reach the Pi at `10.90.0.2`. Caddy does not need the Pi’s residential address, and the public request path does not require one router-forwarding rule per application.

WireGuard solves transport, not application security. It encrypts packets between the two peers and gives them private addresses. It does not decide whether a user may open Docker Control, read a file or start a movie. Those decisions still belong to the reverse proxy, authentication gateway and application.

It also makes the VPS a trusted part of the system. If that machine is compromised, the attacker has a network path towards the Pi’s tunnel address. Keeping the VPS small, patched and narrowly configured is part of the security model, not optional tidying.

## Caddy turns ports into names

On the Pi, applications still listen on ports. Humans should not need to remember them.

Caddy maps each public hostname to one private upstream. The active configuration follows this shape:

```caddyfile
tool.example.com {
    reverse_proxy 10.90.0.2:PORT
}
```

The real Caddyfile contains separate blocks for ToolHub, photos, media, monitoring and the tools I built. Adding a public route means making an explicit hostname-to-service decision rather than opening a home-router port.

Caddy also manages HTTPS for the named sites. Direct records reach the VPS certificate managed by Caddy; proxied Cloudflare records add Cloudflare’s edge in front of it. After HTTPS is handled at the public edge, the final proxy hop can use HTTP inside WireGuard because the tunnel already encrypts that transport.

This is one of those arrangements that looks redundant until the boundaries are separated:

- TLS protects the browser-facing web connection and proves the hostname;
- WireGuard protects the private network hop between machines;
- application authentication decides what the user may do.

One layer does not quietly replace the others.

## Authentication belongs before the sensitive tools

Several applications already have their own login systems. Several small administrative tools do not, or did not have the access policy I wanted.

For those routes, Caddy uses `forward_auth` to ask a gateway on the VPS whether the request is allowed before it contacts the Pi:

```caddyfile
admin-tool.example.com {
    forward_auth 127.0.0.1:8082 {
        uri /internal/auth/check
        copy_headers Cookie Authorization
    }

    reverse_proxy 10.90.0.2:PORT
}
```

The gateway loads a policy for the requested hostname. A policy can require authentication, an administrative role, or an allowed account. Browser navigation without a valid session is sent to the login page; API-style requests receive an unauthenticated response instead of HTML.

After login, the gateway stores a signed session in a secure, HTTP-only cookie for the domain. The current session lasts three days. Caddy can then ask one local endpoint for an access decision instead of teaching every small tool how to implement login, token validation and role checks.

The gateway does not make every upstream trustworthy. A mistakenly public Caddy route is still a mistake, and a service with valuable state should keep its own authorization where practical. The gateway is a consistent front door, not permission to stop thinking behind it.

ToolHub is a good example of the distinction. It owns its application session and protects administrative APIs itself. Standalone admin interfaces such as container logs or Docker Control can use the shared gateway before the first request reaches them.

## Media traffic needed a less elegant rule

Putting an authentication check in front of a normal web page is straightforward. Media clients are less polite.

Jellyfin browsers, phones and televisions make API requests, fetch images, maintain sessions and stream large responses. Redirecting every one of those requests through a generic login page breaks the client’s understanding of the protocol.

My Caddy configuration therefore protects the initial browser-facing entry, then lets Jellyfin’s own authenticated API and media requests pass to Jellyfin. Requests carrying Jellyfin’s application token are handled by Jellyfin rather than being challenged again by the gateway.

That split is not as visually tidy as “put auth in front of everything”, but it respects which component understands the request. The external gateway decides who may enter; Jellyfin remains responsible for its users, sessions and playback permissions.

It is also why I did not want public access to be a single checkbox applied to every container. A log viewer, photo library, media server and JSON API do not have the same traffic shape or authentication model.

## A request is now traceable

When `tool.example.com` fails, I can walk the path in order:

1. Does DNS return the expected public edge?
2. Is Caddy serving a valid certificate and matching the hostname?
3. Does the authentication gateway allow or reject the request as intended?
4. Does WireGuard show a recent peer handshake?
5. Can the VPS reach the Pi’s private tunnel address and application port?
6. Is the container healthy on the Pi?

This sequence is more valuable than it looks. “The website is down” becomes a smaller question at each boundary. A DNS problem, expired session, stale WireGuard peer and stopped container produce different evidence.

Caddy’s configuration can also be validated before reload. That matters because one syntax error at the public edge can affect several otherwise unrelated services.

## What this design does not solve

The public path has useful properties, but I do not want to oversell it.

- It does not make an insecure application secure.
- It does not remove the need to patch the VPS, Pi and containers.
- It does not provide a backup for anything on the SSD.
- It adds latency and another machine that can fail.
- It makes the WireGuard keys and authentication-gateway secret important credentials.
- It requires care when a service uses WebSockets, long streams or unusual client authentication.

The design also centralizes public access at the VPS. That is convenient for certificates, logs and policy, but it creates a clear dependency. I monitor it because every public hostname can look broken when the real failure is one proxy or tunnel.

At the same time, the blast radius is understandable. If the public edge disappears, my home network stays private and the LAN services keep their local paths.

## The useful result is a normal URL

The visible outcome is almost boring: somebody opens a link, signs in if the route requires it, and reaches the service.

Behind that link, Cloudflare answers the name, the VPS receives the connection, Caddy chooses an upstream, the gateway may make an access decision, and WireGuard carries the request to the Pi. The response returns through the same layers without the user needing Tailscale or a list of ports.

That is the practical lesson from this part of the homelab: make the public boundary explicit. DNS, encrypted transport, reverse proxying and authentication are related, but they are not the same job. Giving each one a visible place made the system easier to operate and much harder to expose accidentally.

The next problem started after access worked. A usable media server still needed a way for people to request something, for me to approve it, and for the automation stack to turn that request into a playable file without handing everybody Radarr credentials.

That request and automation path became MovieHub. Part 3 will follow it from a user pressing Request to Jellyfin serving the result, including the parts the Pi can direct-play and the parts it really should not transcode live.

If you expose selected homelab services too, I would be interested in where you draw the boundary: private VPN only, a public reverse proxy, or something in between.

---

*Next: **MovieHub, Jellyfin and the Request Path Behind My Home Media Setup***
