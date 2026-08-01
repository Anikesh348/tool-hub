# How I Put My Homelab on the Internet Without Exposing My Home Network

*Part 2 of **One Pi, One SSD, 48 Containers***

[Tailscale](#term:tailscale) made the Raspberry Pi feel local from my laptop and phone, even when I was away from home. The awkward part arrived when I wanted friends and family to use selected services too. “Install this [VPN](#term:vpn) client and join my private device network first” is reasonable for my own machines. It is not the front door I wanted for everybody else.

I also did not want to open a new [home-router port](#term:router-port-forwarding) for every service. I wanted normal [HTTPS](#term:https) URLs on the outside, a small public [VPS](#term:vps) at the edge, and a private [WireGuard](#term:wireguard) route back to the Pi.

More precisely, “without exposing my home network” means publishing selected services without revealing my residential IP or forwarding their application ports through my home router. The VPS still has a trusted route to one WireGuard address on the Pi. That route is an explicit part of the [trust boundary](#term:trust-boundary), not magic isolation.

The result today is 22 named routes in [Caddy](#term:caddy), including a few aliases and test endpoints. The VPS has 1 vCPU and 0.9 GiB of RAM. Web traffic reaches [TCP and UDP ports](#term:tcp-udp-ports) there: TCP 80 or 443 for the web, and UDP 51820 for WireGuard. No application port in this public path is forwarded from the home router.

![Public request path from a browser over HTTPS to Cloudflare and a VPS, with a local authentication check, then through WireGuard to a Raspberry Pi service](assets/diagrams/public-request-path-v2.svg)

*The VPS is the public boundary. Caddy handles HTTPS and routing there; selected hostnames get a [localhost](#term:localhost) authentication check before HTTP travels inside the encrypted WireGuard tunnel to the Pi.*

For a normal request, the browser first resolves a hostname through [Cloudflare DNS](#term:cloudflare-dns). The connection then reaches the VPS, either directly or through [Cloudflare’s proxy](#term:cloudflare-proxy). Caddy matches the hostname, asks the local gateway for a decision when the route is protected, and forwards the approved request over WireGuard. The application still runs on the Pi and the response returns through the same path.

## The requirement was simpler than the architecture

I wrote down the constraints before choosing components:

- friends and family should open a normal domain in a browser;
- public DNS should never point to my home connection;
- the home router should not forward public application ports;
- different hostnames should reach different services on the Pi;
- HTTPS should renew automatically;
- administrative tools should get an authentication check before loading;
- losing public access should not stop services working on the [LAN](#term:lan).

Tailscale still handles private access for my own devices. This path solves a different problem: carefully selected public access for people who should not need to understand my network first.

## What is actually reachable

The public machine is deliberately narrow, but it is not invisible. Its [firewall](#term:firewall) currently allows TCP 80 and 443 for web traffic, UDP 51820 for WireGuard, and TCP 22 for [SSH](#term:ssh). Caddy also uses [HTTP/3](#term:http3) on UDP 443. An old UDP 10000 firewall allowance remains even though nothing listens on it; removing that rule is on my hardening list.

SSH deserves the same honesty. It currently permits root and password login as well as public-key login. That is not a restriction I can present as a safeguard, so tightening it is another clear follow-up.

At home, this design adds no forwarded application ports. Caddy reaches `10.90.0.2`, the Pi’s tunnel address, and local services keep their independent LAN paths. WireGuard [AllowedIPs](#term:wireguard-allowedips) limits which addresses each peer routes—the VPS and Pi allow only the other peer’s tunnel address—but it is not a port-level firewall.

## Cloudflare names the edge

Cloudflare is authoritative DNS for `hostingfrompurva.xyz`. Every public record in this setup resolves either to Cloudflare’s proxy or directly to the VPS, never to the Pi or my residential address.

For new records, my rule is to proxy ordinary browser tools and use [DNS-only](#term:dns-only) when a long-lived or large media response is easier to debug and serve directly. The current records are still mixed while I test that policy—one media hostname remains proxied—so this is a direction, not a perfectly completed migration.

DNS, Cloudflare proxying and [Cloudflare Tunnel](#term:cloudflare-tunnel) are separate choices. I considered Tunnel, but settled on a [reverse proxy](#term:reverse-proxy) I could inspect end to end and tune per hostname. DNS only answers where a request goes; it does not authenticate the person making it.

## The VPS is deliberately boring

The VPS is not a second homelab. It accepts public requests, handles HTTPS, asks for an authentication decision where required, and proxies approved traffic through WireGuard.

That gives me a stable public address without moving application data away from the Pi. It also adds another Linux machine to patch, monitor and keep small. If it fails, public access stops, but Samba on the LAN and Jellyfin on the television should continue working. That failure isolation was one of the original requirements.

## WireGuard gives Caddy a private road home

The VPS uses `10.90.0.1` on `wg0`; the Pi uses `10.90.0.2` on `wg1`. Each peer routes only the other [/32 tunnel address](#term:cidr-32), and a [persistent keepalive](#term:wireguard-keepalive) helps the connection survive home-network address translation.

WireGuard encrypts the network hop. It does not decide whether somebody may view logs, download a file or administer a container. It also makes the VPS trusted: if the VPS is compromised, the attacker has a route towards the Pi’s tunnel address. Keeping that route narrow matters as much as keeping the tunnel up.

## Caddy turns ports into names

Applications still listen on ports. Humans should not need to remember them.

Each Caddy site block maps a hostname to one private upstream:

```caddyfile
tool.example.com {
    reverse_proxy 10.90.0.2:PORT
}
```

The real configuration has separate blocks for tools, monitoring, photos and media. Publishing a service is therefore an explicit hostname-to-upstream change in one place, rather than a router rule plus a port number somebody has to remember.

Caddy manages certificates for records that reach it directly. Proxied records add Cloudflare’s [TLS](#term:tls) edge in front. After that browser-facing connection terminates, Caddy can use HTTP to the Pi because that hop is inside WireGuard.

The responsibilities are separate:

- TLS protects the browser-facing connection and proves the hostname;
- WireGuard protects transport between the VPS and Pi;
- application authentication decides what the user may do.

None of the three silently replaces another.

## I built the authentication decision between them

Caddy and WireGuard provide routing and transport. I built the [authentication gateway](#term:authentication-gateway) and hostname-based policy model that sit between the public edge and selected applications.

For a protected hostname, Caddy uses [forward_auth](#term:caddy-forward-auth) to call the gateway over localhost before contacting the Pi:

```caddyfile
admin-tool.example.com {
    forward_auth 127.0.0.1:8082 {
        uri /internal/auth/check
        copy_headers Cookie Authorization
    }
    reverse_proxy 10.90.0.2:PORT
}
```

The gateway selects an exact policy from the original hostname. Policies can require a session, an administrative role or an allowed account. A normal browser without a valid session is redirected to login; an API-style request receives an [HTTP 401 response](#term:http-401) instead of an HTML page.

The session is a [signed, stateless token](#term:stateless-session) stored in a [Secure, HttpOnly, SameSite=Lax cookie](#term:secure-cookie-flags). Stateless verification keeps the gateway simple, but it also means an individual session cannot be centrally revoked before expiry. The gateway is a consistent front door; upstream applications should still keep their own authorization where it matters.

## Media traffic needed a less tidy rule

A generic login redirect can break [Jellyfin](#term:jellyfin) API, image, session and streaming requests. My external gateway protects the browser-facing entry where appropriate, then lets Jellyfin handle requests carrying its own [application token](#term:application-token).

That split is less visually neat than putting one login in front of everything, but the component that understands the protocol should retain playback authorization.

## A request is now traceable

When a hostname fails, I walk the path in order:

1. **DNS:** does it resolve to Cloudflare or the VPS?
2. **Caddy and TLS:** is the certificate valid and the hostname matched?
3. **Authentication:** did the gateway allow, redirect or reject the request?
4. **WireGuard:** does the peer show a recent handshake?
5. **Tunnel reachability:** can the VPS reach the Pi’s tunnel address and upstream port?
6. **Application:** is the container healthy on the Pi?

That turns “the website is down” into six smaller questions. I also run [Caddy’s configuration validation](#term:caddy-config-validation) before reload so one syntax error does not take several unrelated routes down with it.

## How I verified the boundary

I checked public DNS answers against Cloudflare and the VPS address, inspected the VPS firewall and listening sockets, and confirmed the WireGuard peer addresses and handshake. From the VPS, I tested the Pi services through `10.90.0.2` rather than through a public home address.

I tested unauthenticated browser navigation separately from API requests because the expected outcomes differ: redirect for the former, `401` for the latter. I also validated the active Caddyfile before reload. These checks verify the path I designed; they are not a penetration test or a general security audit.

## What this design does not solve

**Security.** An insecure application remains insecure. The VPS, Pi and containers still need patching, while WireGuard keys and the gateway signing secret remain sensitive credentials. The SSH and unused firewall rules above are real hardening work still to do.

**Reliability.** The VPS and tunnel are dependencies for public access. Their failure should not stop LAN services, but it does make every public hostname appear unavailable at once.

**Compatibility and operations.** [WebSockets](#term:websockets), long streams and non-browser clients can need special handling. The design adds latency, monitoring and another machine to operate.

## The useful result is a normal URL

The visible outcome is almost boring: somebody opens a link, signs in if required and reaches the service. They do not need Tailscale or a list of ports.

The useful part was not merely getting traffic to the Pi. It was designing the trust and failure boundaries so losing public access did not affect services running locally. DNS, TLS, encrypted transport and authentication are related, but they remain different jobs.

The next problem started after access worked. A usable media server still needed a way for people to request something, for me to approve it, and for the automation stack to turn that request into a playable file without handing everybody Radarr credentials.

That request path became MovieHub. Part 3 will follow it from a user pressing Request to Jellyfin serving the result, including what the Pi can direct-play and what it really should not transcode live.

If you expose selected homelab services too, I would be interested in where you draw the boundary: private VPN only, a public reverse proxy, or something in between.

---

*Next: **MovieHub, Jellyfin and the Request Path Behind My Home Media Setup***
