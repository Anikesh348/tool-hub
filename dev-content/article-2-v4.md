# How I Put My Homelab on the Internet Without Exposing My Home Network

*Part 2 of **One Pi, One SSD, 48 Containers***

[Tailscale](#term:tailscale) worked well when the only remote user was me. My laptop and phone could reach the Pi as if they were still at home.

The problem appeared when I wanted friends and family to use a few services. “Install this VPN client and join my private device network first” is reasonable for my own machines. It is not the front door I wanted for everybody else.

My first obvious option was [router port forwarding](#term:router-port-forwarding), but opening a new route into the house for every application felt like the wrong direction. I wanted ordinary [HTTPS](#term:https) links without publishing my residential address or the Pi’s application ports.

I did not begin with the final stack in mind. While looking for a safer public front door, I came across three pieces that fitted together: a small public [VPS](#term:vps) for a stable internet address, [Caddy](#term:caddy) for turning hostnames into routes, and [WireGuard](#term:wireguard) for a private road from that VPS back to the Pi.

That experiment now supports 22 named routes in Caddy, including a few aliases and test endpoints. The public VPS is tiny—1 vCPU and 0.9 GiB of RAM—and the home router still forwards no Pi application ports.

![The public architecture from a browser through Cloudflare and the VPS, with Caddy, an optional authentication decision and a WireGuard route to the Raspberry Pi](assets/diagrams/public-request-path-v2.svg)

*The VPS is the public boundary. Caddy handles HTTPS and hostname routing there, the authentication gateway protects selected services, and WireGuard provides the private route to the Pi.*

## The requirement was simpler than the architecture

Before choosing components, I wrote down what I actually wanted:

- a normal link for friends and family;
- no public DNS record pointing to my home connection;
- no separate router rule for every Pi application;
- automatic HTTPS;
- a login check in front of sensitive tools;
- local services that keep working when the public route fails.

Tailscale still handles my private access. The new path is only for services I deliberately publish.

## Follow this article from your browser to my Pi

The page you are reading is a useful example. On dev, its hostname is `dev.hostingfrompurva.xyz`, and the page path is `/blogs/article-2`.

![The journey of this blog request from the browser through Cloudflare, Caddy and WireGuard to the ToolHub dev frontend on the Raspberry Pi, then back to the browser](assets/diagrams/blog-request-journey-v1.svg)

*For this public blog route, Caddy does not pause for the authentication gateway. It matches the dev hostname and sends the request through WireGuard to ToolHub on the Pi.*

1. Your browser asks [Cloudflare DNS](#term:cloudflare-dns) where that hostname lives.
2. Because this record is proxied, the browser establishes HTTPS with Cloudflare. Cloudflare then opens its own HTTPS connection to my VPS.
3. Caddy receives the hostname `dev.hostingfrompurva.xyz` and matches it to one route in its configuration.
4. That route crosses WireGuard to the ToolHub dev frontend on the Pi.
5. The article returns through the same path.

The browser sees a normal website. It never connects to my home address, the Pi’s tunnel address or an application port. Caddy hides those details behind the hostname, which is the main job of a [reverse proxy](#term:reverse-proxy).

## How the padlock appears without a certificate calendar

When I add a hostname to Caddy, it requests a certificate from [Let’s Encrypt](#term:lets-encrypt) and proves that the VPS controls that hostname. Caddy stores the certificate, serves it when a visitor connects, and renews it automatically before it expires.

The browser checks that the certificate belongs to the requested hostname, comes from a trusted issuer and is still valid. It then establishes encrypted [TLS](#term:tls) keys for the HTTPS connection. That is what turns an ordinary HTTP conversation into the padlocked connection in the address bar.

Cloudflare-proxied records have two encrypted legs: browser to Cloudflare, then Cloudflare to Caddy. Direct records connect the browser straight to Caddy. In both cases, Caddy has a valid certificate for the hostname.

## WireGuard created a tiny network between two machines

The tunnel has its own private addresses. The VPS is `10.90.0.1` and the Pi is `10.90.0.2`. These are not public internet addresses and they are not extra addresses for every device on my home network. They exist only on the WireGuard connection between these two peers.

When Caddy sends a request to `10.90.0.2`, the VPS knows that address belongs through the encrypted tunnel. The Pi receives it on the other end and hands it to the chosen application.

WireGuard’s `AllowedIPs` setting keeps this route narrow by listing only the other peer’s tunnel address. It controls where tunnel traffic is routed; the VPS firewall still controls which public traffic the machine accepts.

In plain terms, the public machine accepts web traffic, the WireGuard connection and my administrative SSH access. At home, the public path adds no application-port forwarding. Services also keep their separate [LAN](#term:lan) addresses, so Jellyfin on the television does not depend on the VPS.

## A sensitive route takes one extra turn

`metrics.hostingfrompurva.xyz` uses the same public edge, but Caddy does not immediately send it to the Pi. It first asks the [authentication gateway](#term:authentication-gateway) I built on the VPS.

The gateway reads the requested hostname and applies its policy. An unauthenticated browser is sent to the shared sign-in page. A non-browser request receives a `401` response instead of a page it cannot use.

![The real ToolHub SSO page shown when an unauthenticated browser opens the protected metrics hostname](assets/screenshots/article-2/metrics-auth-gateway.jpg)

*This is the real detour produced by opening the metrics hostname without a session. The monitoring dashboard has not received the request yet.*

After sign-in, the gateway verifies a signed session cookie and checks whether the account is allowed for that hostname. An allowed request returns to Caddy and continues through WireGuard to the metrics service. A rejected request stops at the gateway; it never reaches the monitoring application.

Caddy and WireGuard provided the routing and transport. The hostname policy, browser-versus-API behaviour and account decision were the part I built because the smaller tools did not share one useful login model.

## Cloudflare is a choice per hostname

Cloudflare remains the DNS provider for every public hostname, but not every record needs its proxy.

I use the proxy for ordinary browser tools such as this dev blog. For some long-lived or large media responses, a direct DNS record is easier to serve and debug. The current setup is still mixed while I test that rule, so I treat it as a practical choice rather than a badge that one option is always safer.

DNS tells a browser where to connect. Caddy chooses the application. WireGuard protects the private trip home. Authentication decides who may continue. Keeping those jobs separate made the system easier to reason about.

## A request is now traceable

When a hostname fails, I follow the same journey in order:

1. Does DNS point to Cloudflare or the VPS as expected?
2. Does HTTPS load with the correct certificate?
3. Does Caddy match the hostname?
4. Does the gateway allow, redirect or reject the request?
5. Is the WireGuard peer connected?
6. Is the application healthy on the Pi?

I also validate Caddy’s configuration before reloading it. That small check matters because one bad route at the shared front door could affect several unrelated services.

## What this design does not solve

The VPS and tunnel are extra dependencies for public access. They add monitoring, patching and some latency. I also still need to tighten SSH access on the VPS.

The authentication gateway does not make an insecure application secure, and the VPS is trusted with a route to the Pi’s tunnel address. Keys, session-signing secrets and application authorization still matter.

The useful failure boundary is that a broken public edge should only break remote access. The Pi, its storage and the services used on my LAN should continue working.

## The useful result is still a normal URL

What a visitor sees is almost boring: open a link, sign in if the route is protected, and use the service.

I arrived there by learning what each layer could solve, not by choosing a stack first. The useful engineering lesson was to keep the public, authentication and home-network boundaries visible while making them disappear from the user’s experience.

The next problem started after access worked. A usable media server still needed a way for people to request something, for me to approve it, and for the automation stack to turn that request into a playable file without handing everybody Radarr credentials.

That request path became MovieHub. Part 3 will follow it from a user pressing Request to Jellyfin serving the result, including what the Pi can direct-play and what it really should not transcode live.

If you expose selected homelab services too, I would be interested in where you draw the boundary: private VPN only, a public reverse proxy, or something in between.

---

*Next: **MovieHub, Jellyfin and the Request Path Behind My Home Media Setup***
