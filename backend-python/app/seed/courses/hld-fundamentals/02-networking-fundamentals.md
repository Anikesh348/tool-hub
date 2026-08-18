> **Learning goal**
> Understand the networking building blocks that every client-server system relies on — the OSI model, IP addresses, DNS, proxies, HTTP/HTTPS, TCP vs UDP, load balancing algorithms, and checksums — so that when later lessons say "a request goes from the client to the server," you know exactly what that sentence is hiding.

## 2.1 Overview

Module 1 covered the *qualities* a system should have — scalable, available, reliable — and the mechanics of failure. This module is about the *plumbing* those qualities run on top of: the actual path a request takes from a user's browser to a server, and back, and everything that can go right or wrong along the way.

These eight topics build on each other in the order they're presented. The **OSI model** gives you a map of the whole stack, so every other topic in this lesson has a "floor" it lives on. **IP addresses** are how machines find each other at the network layer. **DNS** is the lookup service that lets humans use names instead of memorizing IP addresses. **Proxies and reverse proxies** are intermediaries that sit in the request path for privacy, security, or traffic distribution. **HTTP/HTTPS** and **TCP vs UDP** describe the actual conversation format and delivery guarantees used once a connection is established. **Load balancing algorithms** are the specific rules used to decide which backend server handles a given request once traffic is distributed. And **checksums** close the loop by explaining how systems detect when any of the above got corrupted along the way.

By the end of this module you should be able to narrate, in specific technical terms, everything that happens between typing a URL into a browser and a web page appearing — which is exactly the kind of narration Stage 4 of the interview framework (drawing the high-level architecture) rewards.

## 2.2 The OSI Model

The **OSI model** is a seven-layer reference model for describing how network communication happens, built from raw physical signals at the bottom up to recognizable applications like a web browser at the top. Nobody implements networking software by literally checking off each of the seven layers in order — but the model is enormously useful as a shared vocabulary for describing *where* in the stack something is happening, which is exactly what you need when troubleshooting or explaining a design.

Here's the stack, bottom to top, with a plain-language description and a concrete real-world example at each layer:

| Layer | Name | What it does | Example |
| --- | --- | --- | --- |
| 7 | Application | Defines the actual meaning of the exchanged data | HTTP, DNS, SSH |
| 6 | Presentation | Formats, compresses, encrypts the data | JSON serialization, gzip, TLS |
| 5 | Session | Manages the lifecycle of a conversation | TLS session, WebSocket connection |
| 4 | Transport | Delivers data to the right process on a machine | TCP (reliable), UDP (best-effort) |
| 3 | Network | Routes data between different networks | IP addresses, routers |
| 2 | Data Link | Delivers data within one local network | Ethernet, MAC addresses, switches |
| 1 | Physical | Transmits raw signal | Copper cable, fiber, radio waves |

The mental model that makes this stick: think of mailing a letter inside a series of nested envelopes. The application layer writes the actual letter (an HTTP request). Each layer below it stuffs that letter into another envelope with its own routing information written on the outside — this is called **encapsulation**. By the time the physical layer sends it, you have a letter inside an envelope inside a box inside a truck. The receiving machine does the reverse — **decapsulation** — stripping one layer of "envelope" at a time as the data moves back up its own stack, until the original letter is handed to the receiving application.

Why any of this matters practically: it turns vague complaints into diagnosable ones. "The website is down" could mean a dozen different things, but framed through OSI layers, you can narrow it fast. Can you ping the server at all? (Layer 3 problem if not.) Does the TCP connection establish? (Layer 4.) Does the TLS handshake complete? (Layer 5/6.) Does the server return a valid HTTP response? (Layer 7.) Each question isolates a different layer, and a networking engineer working through them top-down or bottom-up will find the broken layer far faster than someone just staring at "it's broken."

The gotcha for beginners: the layers most relevant to day-to-day system design work are 3 (IP/routing), 4 (TCP/UDP), and 7 (HTTP and friends) — the rest of this lesson lives almost entirely in those three. Layers 5 and 6 in particular are often folded into what a modern engineer just thinks of as "the application layer," since TLS and serialization libraries handle them transparently. Knowing the full seven-layer model is still valuable as the map, even if you spend most of your time on three of its layers.

## 2.3 IP Addresses

An **IP address** is a numeric label assigned to a device on a network, used by routers to figure out where to send a packet of data. The important mental shift for beginners: think of an IP address as a *routing coordinate*, closer to a mailing address than to a fixed identity — it tells the network where to deliver something right now, but it isn't a permanent fingerprint of "this is device X forever." Addresses get reused, reassigned, and translated constantly.

**IPv4** addresses are 32 bits long, conventionally written as four numbers 0-255 separated by dots (like `192.168.1.10`). That gives roughly 4.3 billion possible addresses — which sounded like plenty in the 1980s and has since run out for public use, which is a big part of why the internet relies so heavily on address translation today (more on that below). Addresses are grouped using **CIDR notation**, written like `10.0.0.0/24`, where the number after the slash says how many of the 32 bits are fixed as the "network" portion; the remaining bits identify individual hosts inside that network. A `/24` fixes the first 24 bits, leaving 8 bits (256 addresses) free for hosts — this is the most common size for a small office or cloud subnet.

Some address ranges are reserved as **private** and are never routed on the public internet — `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`. Every home router, office network, and cloud VPC reuses these same ranges internally, which is only possible because they never need to be globally unique — they only need to be unique *within* their own private network.

This is where **NAT (Network Address Translation)** comes in: it's the mechanism that lets an entire private network share a single public IP address. When a laptop on your home Wi-Fi (say, `192.168.1.10`) sends a request to a website, your router rewrites the source address to its own public IP before sending it out, and remembers the swap so it can rewrite the reply back to `192.168.1.10` when the response arrives. This conserves scarce public addresses and adds a layer of isolation, but it does add real complexity — the router has to track this mapping as state, inbound connections initiated *from* the internet don't work by default (which is why port forwarding exists), and services on the receiving end often need special handling (like trusted `X-Forwarded-For` headers) to recover the original client IP for logging or rate-limiting.

Routers decide where to send a packet using **routing tables**, matched by **longest-prefix match** — if a packet's destination matches both a broad rule (`10.0.0.0/8`) and a narrower, more specific one (`10.0.5.0/24`), the router uses the more specific rule, because a narrower prefix implies more precise knowledge about that particular slice of the address space.

**IPv6** exists to solve the exhaustion problem outright: its addresses are 128 bits, providing a space so large that address scarcity essentially stops being a concern. Since IPv4 and IPv6 are not directly interoperable, most real networks run **dual-stack** — supporting both protocols side by side during a slow, multi-decade transition — rather than a clean cutover.

The practical gotcha: don't design a system that treats an IP address as a stable proxy for "this is the same user" or "this is a trusted client." Behind NAT, thousands of users can share one IP; on mobile networks, a user's IP can change every few minutes as they roam between towers. Use real identity mechanisms (auth tokens, session cookies) for anything that actually needs to identify a user — IP addresses are for routing, not identity.

## 2.4 DNS (Domain Name System)

**DNS** is the system that translates human-friendly domain names (`example.com`) into the numeric IP addresses machines actually need to establish a connection. Without it, you'd have to memorize IP addresses for every website you wanted to visit — DNS is what lets "type a name" work at all.

Here's the lookup sequence a fresh request goes through, described as a chain of "do you know this?" questions, each one escalating to a more authoritative source only if the previous one comes up empty:

1. **Browser cache** — has this browser already looked up this domain recently? If yes, done instantly.
2. **OS-level cache** — has anything on this machine looked it up recently?
3. **Recursive resolver** — typically run by your ISP or a public service like Google's `8.8.8.8` or Cloudflare's `1.1.1.1`; this is the component that actually does the legwork of tracking down the answer on your behalf if nothing was cached.
4. **Root servers** — a small set of globally distributed servers that don't know the final answer, but know which server is responsible for the domain's top-level extension (`.com`, `.org`, etc.) and point the resolver there.
5. **TLD servers** — servers responsible for a specific extension like `.com`; they don't know the final IP either, but they know which server is *authoritative* for the specific domain being asked about, and point the resolver there.
6. **Authoritative name server** — the actual source of truth for that domain, run by whoever manages `example.com`'s DNS records. This is where the real answer lives.
7. **Answer flows back** down the chain to the browser, getting cached at each level along the way (with an expiration time called a TTL) so the next lookup can skip straight to a cached answer instead of repeating the whole chain.

```text
Browser cache -> OS cache -> Recursive resolver
                                   |
                          Root servers (".", knows who handles .com)
                                   |
                          TLD servers (.com, knows who handles example.com)
                                   |
                     Authoritative server for example.com
                                   |
                        Returns the actual IP address
```

DNS doesn't only store the "name to IPv4 address" mapping — that specific mapping is called an **A record**. Other common record types include **AAAA** (name to IPv6 address), **CNAME** (an alias pointing one name at another name), **MX** (which mail servers handle email for a domain), and **TXT** (arbitrary text, often used to prove domain ownership for third-party services).

DNS is also quietly one of the load-distribution and reliability tools in a system designer's kit, not just a lookup service. **Anycast** lets the same IP address be announced from many physical locations around the world, and the network itself routes a client to whichever announcement is topologically nearest — this is how services like `1.1.1.1` respond fast everywhere without a single central server. **GeoDNS** returns different IP addresses depending on where the requester is located, directing users to their nearest data center. And returning multiple IP addresses for one A record is a crude but effective form of load balancing, spreading client connections across several servers.

The practical gotcha: **TTL (time to live)** on a DNS record controls how long an answer stays cached before clients re-check it — and this creates a real trade-off during operations like a data center failover. A long TTL means fewer lookups (less latency, less load on the resolver) but also means that if you need to redirect traffic away from a failing server *right now*, some fraction of users will keep hitting the old, cached IP address until their TTL expires. Teams that plan for failover deliberately keep TTLs short on records they might need to repoint quickly.

## 2.5 Proxy vs Reverse Proxy

Both a **forward proxy** and a **reverse proxy** are intermediaries that sit in the middle of a request's journey — the confusing part for beginners is that they sit on *opposite sides* of that journey, serving opposite purposes, even though the word "proxy" appears in both names.

A **forward proxy** sits in front of the *client* and acts on the client's behalf. Picture an office network where every employee's outbound web traffic first passes through a proxy server before reaching the internet. From the destination website's point of view, all the requests appear to come from the proxy's IP address — the individual employees' real IPs are hidden behind it. This is used for client anonymity, for enforcing content filtering or access policies (blocking certain sites at the office), for caching frequently-requested pages to save bandwidth, and — less legitimately, but commonly — for getting around geographic content restrictions by routing traffic through a proxy located in a different country.

A **reverse proxy** sits in front of a group of *servers* and acts on their behalf. From the client's point of view, they're just talking to "the website" — they have no idea whether there's one server or a thousand servers behind that single address, because the reverse proxy is the only thing they can actually see. This is the far more common pattern in system design work: it's used to hide server infrastructure details from the outside world, distribute incoming requests across a fleet of backend servers (a load balancer is, functionally, a specialized reverse proxy), cache static content close to the edge, handle TLS termination in one central place so individual backend servers don't each need to manage certificates, and inspect/block malicious traffic before it ever reaches an application server.

```text
Forward proxy:
  [Client A] -\
  [Client B] --> [Forward Proxy] --> Internet
  [Client C] -/
  (proxy hides the clients from the destination)

Reverse proxy:
                              /--> [Server 1]
Internet --> [Reverse Proxy] ----> [Server 2]
                              \--> [Server 3]
  (proxy hides the servers from the client)
```

A concrete real-world pairing: Cloudflare, sitting in front of millions of websites, is a reverse proxy — it protects those sites' actual servers from being directly reachable, absorbs DDoS traffic, and can serve cached content itself without ever bothering the origin server. A corporate VPN client or a streaming-service-unblocking browser extension, on the other hand, is acting as a forward proxy for you the client.

The practical gotcha: don't assume "proxy" always implies caching, and don't assume a reverse proxy is only about load balancing. A single reverse proxy layer (like Nginx or Envoy) commonly does several of these jobs at once — TLS termination, load balancing, static asset caching, and request filtering — which is exactly why it shows up as one box doing a lot of quiet, unglamorous work near the top of almost every high-level system design diagram.

## 2.6 HTTP/HTTPS

**HTTP** is the request-response protocol that almost all web traffic is built on: a client sends a request (a method like `GET`, `POST`, `PUT`, or `DELETE`, a target path, some headers, and optionally a body), and the server sends back a response (a status code, headers, and optionally a body). It's worth internalizing the vocabulary of status codes at a glance: 2xx means success, 3xx means redirect, 4xx means the client made a mistake (like requesting something that doesn't exist), and 5xx means the server made a mistake.

HTTP is fundamentally **stateless** — the protocol itself has no memory of previous requests from the same client. Every request stands alone. Anything that feels like "the server remembers me" (being logged in, a shopping cart persisting between pages) is actually built on top of HTTP, not part of it — typically via a cookie the client sends back on every subsequent request, which the server uses as a lookup key into its own session store.

Two properties of HTTP methods matter a lot for building reliable systems: **safety** and **idempotency**. A *safe* method (`GET`, `HEAD`) doesn't change anything on the server — it's just a read. An *idempotent* method produces the same end state no matter how many times it's repeated — `GET`, `PUT`, and `DELETE` are idempotent (deleting the same resource twice leaves it deleted either way), but `POST` generally is not (submitting the same "create an order" request twice usually creates two orders). This distinction directly drives retry logic: it's safe for a client or load balancer to automatically retry a failed `GET` or `PUT`, but blindly retrying a failed `POST` risks creating duplicates unless the application adds its own idempotency key to make it safe.

**HTTPS** is HTTP layered on top of **TLS** encryption, and it buys you three specific guarantees: *confidentiality* (nobody eavesdropping on the network can read the contents), *integrity* (nobody can silently tamper with the data in transit without detection), and *server authentication* (a certificate cryptographically proves you're actually talking to the server you think you are, not an impostor). It's worth being precise about what HTTPS does *not* guarantee: it says nothing about whether the *user* is who they claim to be (that's a separate authentication problem), and it can't protect data once it's sitting decrypted on a compromised endpoint.

Establishing that encrypted connection requires a **TLS handshake** before any HTTP request can even be sent: the client and server agree on a TLS version, the server presents its certificate for verification, and both sides derive a shared encryption key. Modern TLS 1.3 uses a technique that provides **forward secrecy** — meaning even if the server's long-term private key were stolen in the future, past conversations recorded by an eavesdropper still couldn't be decrypted, because each session's actual encryption key was ephemeral and never stored anywhere.

HTTP itself has evolved across three major versions, each solving a specific bottleneck of the last:

| Version | Key change | Limitation solved |
| --- | --- | --- |
| HTTP/1.1 | Text-based, reuses one TCP connection | Avoided reconnecting for every request, but one slow request blocks the ones behind it on the same connection |
| HTTP/2 | Binary framing, multiple parallel streams over one TCP connection | Fixed application-level blocking, but a lost TCP packet still stalls everything on that connection |
| HTTP/3 | Runs over QUIC (built on UDP) instead of TCP | Fixed the remaining TCP-level stall, and lets a connection survive a client switching networks (e.g., Wi-Fi to cellular) |

For caching, HTTP has its own built-in vocabulary: `Cache-Control` headers tell a client or intermediate proxy how long a response can be reused without asking the server again, and `ETag` combined with conditional requests (`If-None-Match`) lets a client ask "has this changed since I last saw it?" and get back a cheap "no, use what you have" instead of re-downloading unchanged content.

The gotcha in production systems: always set explicit timeouts at every stage — DNS lookup, connection establishment, TLS handshake, and the request itself — because a hung request with no timeout can quietly tie up a connection (and the thread or resource behind it) indefinitely. Combine that with bounded retries that use backoff and jitter, so a struggling server doesn't get hit with a synchronized wave of retries from every client at once.

## 2.7 TCP vs UDP

**TCP** and **UDP** are the two dominant transport-layer protocols (Layer 4 in the OSI model), and the choice between them comes down to one question: what should happen when data is delayed, lost, duplicated, or arrives out of order?

**TCP (Transmission Control Protocol)** answers that question with "fix it automatically, and don't hand the application anything until it's correct." It establishes a connection first, via a **three-way handshake** (SYN, SYN-ACK, ACK), before any actual data flows. Once connected, it guarantees the receiving application sees the data as one ordered, complete byte stream — it automatically retransmits anything lost, reorders anything that arrived out of sequence, and drops duplicates. It also manages **flow control** (not overwhelming a slow receiver) and **congestion control** (backing off when the network itself seems congested). The cost of all this reliability is a phenomenon called **head-of-line blocking**: if one segment of data is lost, everything sent after it has to wait for that one segment to be successfully retransmitted before any of it can be delivered to the application, even if the later data already arrived fine.

**UDP (User Datagram Protocol)** answers the same question with "don't bother — send it and move on." There's no handshake, no guaranteed delivery, no guaranteed ordering, and no automatic retransmission. Each UDP datagram is independent, and it arrives as a whole unit or not at all (no partial-message reassembly headaches). Its header is a lean 8 bytes, versus roughly 20 bytes minimum for TCP, and there's no connection setup delay. If an application needs *some* reliability on top of UDP, it has to build it itself.

| | TCP | UDP |
| --- | --- | --- |
| Connection | Handshake required | None — connectionless |
| Delivery guarantee | Reliable, ordered | Best-effort, no order guarantee |
| Speed | Slower to establish, has retransmission overhead | Immediate, minimal overhead |
| Use when | Completeness matters more than freshness | Freshness matters more than completeness |
| Examples | Web (HTTP/1.1, HTTP/2), databases, SSH, email | DNS, live video/audio, multiplayer games, WebRTC |

The examples column reveals the real decision rule. A database write absolutely cannot tolerate silently dropping or reordering bytes — TCP is the obvious choice. A live video call, on the other hand, is better served by dropping a stale, half-second-old video frame and moving on to the current one than by TCP-style stalling everything to retransmit that old frame — by the time it arrived, it would be useless anyway. This is exactly why real-time video and voice traffic (and gaming, and DNS lookups, which need to be fast far more than they need retry machinery) typically ride on UDP.

Interestingly, HTTP/3's underlying protocol, **QUIC**, is built on top of UDP but reimplements reliability, ordering (per-stream, not globally), encryption, and congestion control itself, from scratch, in a way that avoids TCP's head-of-line blocking problem — proving that TCP's guarantees and UDP's flexibility aren't mutually exclusive if you're willing to build the reliability layer yourself instead of using the OS's built-in TCP stack.

The gotcha: don't assume "TCP means reliable" translates all the way up to "my application logic is automatically safe." TCP guarantees byte-level delivery on one connection — it says nothing about what happens if the *connection itself* drops mid-request and the client has to retry over a brand-new connection. That's exactly the idempotency problem discussed in the HTTP section, and it exists regardless of which transport protocol is underneath.

## 2.8 Load Balancing (algorithms)

A **load balancer** distributes incoming requests across a pool of backend servers, and its whole job is deciding, for each incoming request, which specific server should handle it. The algorithm behind that decision has a real, measurable effect on both performance and fairness across the fleet — the wrong algorithm for a given workload can leave some servers idle while others are overloaded.

**Round robin** is the simplest approach: cycle through the list of servers in order, sending request 1 to server A, request 2 to server B, request 3 to server C, request 4 back to server A, and so on. It's dead simple to implement and works well when every server has identical capacity and every request costs roughly the same amount of work. It falls apart when servers are heterogeneous (some bigger than others) or when requests vary wildly in cost, because round robin has no concept of "how busy is this server right now."

**Weighted round robin** fixes the heterogeneous-server problem by assigning each server a weight proportional to its capacity — a server twice as powerful gets roughly twice as many requests in each cycle. This is common in real deployments where a fleet has a mix of instance sizes, often during a gradual hardware upgrade.

**Least connections** routes each new request to whichever server currently has the fewest active connections. Unlike the two round-robin variants, this reacts to real-time load rather than blindly cycling — if one server is stuck processing a batch of slow requests, new traffic naturally routes elsewhere instead of piling onto it. The cost is that the load balancer now has to track live connection counts per server rather than just cycling through a static list.

**Least response time** goes a step further, routing to whichever server has been responding fastest recently — directly optimizing for the thing users actually feel (latency), rather than using connection count as an indirect proxy for load. The practical challenge is that measuring "current response time" accurately in a live, constantly-changing system is harder than counting connections, and the metric can lag reality by the time it's used.

**IP hash** computes a hash of the client's IP address and uses that to consistently pick the same backend server for that client every time (conceptually the same idea as consistent hashing from Module 1, applied here to request routing instead of data storage). This buys **session persistence** — useful if a server holds some session state locally and you need the same client to keep landing on it — but it has a real downside: if a huge number of users happen to sit behind the same corporate NAT gateway (sharing one public IP), they'll all get hashed to the same backend server, creating an uneven hotspot despite the algorithm's name suggesting even distribution.

```text
Round robin:        A -> B -> C -> A -> B -> C ...
Least connections:  send to whichever of {A, B, C} has fewest active requests right now
IP hash:             hash(client_ip) -> always the same server for that client
```

The practical decision rule: use round robin (or its weighted variant) for simple, homogeneous, stateless fleets where requests cost roughly the same. Use least connections or least response time when request cost varies significantly and you want the balancer to actually react to real load. Use IP hash (or a cookie-based alternative) only when you genuinely need session persistence — and prefer designing the application to be stateless in the first place, per Module 1's scalability lesson, so you don't need session persistence at all.

## 2.9 Checksums

A **checksum** is a small value computed from a larger piece of data, used to detect whether that data has changed — whether from accidental corruption or, with the right algorithm, deliberate tampering. The core idea is simple: compute the checksum before sending or storing something, compute it again after receiving or reading it back, and if the two values don't match, something changed along the way.

It's worth being precise about what checksums do and don't protect against. A basic checksum is excellent at catching *accidental* corruption — a bit flipped by a faulty memory chip, a write truncated by a crash mid-save, noise introduced during a long network transfer. It is not, by itself, a defense against a deliberate attacker, because a sufficiently motivated attacker can usually recompute a matching checksum for their tampered data unless the algorithm was specifically designed to resist that.

This split gives you two broad families of checksum algorithms:

- **CRC (Cyclic Redundancy Check)** algorithms are fast and good at catching the kind of random, "noisy" corruption you'd expect from a flaky cable or a failing disk sector — think of the checksum built into every Ethernet frame and TCP/UDP packet. They're computationally cheap but easy to defeat deliberately, so they're purely for catching accidents, not for security.
- **Cryptographic hashes** (SHA-256, BLAKE3, and similar) produce a fixed-size digest with a much stronger property: it should be computationally infeasible for anyone to find two different inputs that produce the same digest, or to reverse-engineer the original data from the digest. This is what you want whenever tampering, not just accidental corruption, is a real concern — verifying a downloaded software package hasn't been swapped for malware, for instance.

For situations where you additionally need to prove *who* produced the checksum (not just that the data is unchanged), plain hashes aren't enough on their own — you need **HMACs** (which combine a hash with a secret key shared between two trusted parties, so only someone holding that secret could have produced a valid value) or **digital signatures** (which use a public/private key pair, so anyone can verify the signature but only the private key holder could have created it).

Checksums show up at nearly every layer of a real system, often stacked on top of each other: Ethernet frames and TCP/UDP packets carry their own checksums at the networking layers; disks and databases checksum individual blocks to catch silent hardware corruption ("bit rot"); object storage services checksum uploaded files; package managers checksum downloads before installing them; and distributed databases compare checksums between replicas to detect when copies of the same data have quietly drifted out of sync with each other.

A few practical design principles worth internalizing: **granularity matters** — checksumming a whole 10 GB file as one unit tells you *that* something broke but not *where*, forcing a full re-transfer, while checksumming it in small chunks lets you re-fetch only the corrupted chunk, at the cost of more metadata to track. **Verify at both boundaries** — check data both when it's written and when it's later read back, since corruption can happen while data is just sitting at rest (a failing disk), not only in transit. **Detection is not the same as recovery** — a checksum mismatch tells you something is wrong, but you still need a separate plan for what to do about it (retry, request a resend, pull from a healthy replica, or quarantine the corrupted copy). And finally, **verify end-to-end** — checksums at a lower layer (like the network card) don't guarantee correctness at a higher layer (like the application's own file format), because corruption can be introduced by a bug above the layer that's already been checked; the strongest guarantees come from checksumming as close as possible to the actual point of use.

## 2.10 Summary and how these connect

Trace a single request through this module's topics and you get the full journey: a user types a URL, and **DNS** resolves the domain to an IP address, possibly returning a different address depending on the user's location if GeoDNS or anycast is in play. The browser opens a **TCP** connection to that **IP address** and, for HTTPS, performs a TLS handshake for encryption and server authentication. The request may first hit a **reverse proxy** or a **load balancer**, which picks a specific backend server using an algorithm like least connections or IP hash. The actual message exchanged is an **HTTP** request and response, riding on top of that TCP connection, which itself is a Layer 4 protocol sitting inside the **OSI model**'s broader stack of IP routing (Layer 3) and physical transmission (Layer 1) underneath it. And quietly, underneath almost every one of those steps, **checksums** are running in the background at the network and storage layers, catching corruption before it becomes a customer-visible bug.

None of this plumbing exists for its own sake — it exists to make the qualities from Module 1 achievable. DNS's anycast and multiple-A-record tricks are availability techniques wearing a networking hat. A reverse proxy performing load balancing is horizontal scaling in action. TCP's reliability guarantees are what let you build correctness (reliability, in Module 1's sense) on top of an unreliable physical network. And choosing UDP over TCP for a real-time video feature is the latency-versus-completeness trade-off from the latency/throughput lesson, made concrete in a real protocol choice.

With Modules 1 and 2 together, you now have both halves of the vocabulary this course builds on: the qualities a system should have, and the plumbing that carries every request those qualities are being measured against. Later lessons that walk through full architectures will lean on both without re-explaining them — when a lesson says "put a reverse proxy in front of a horizontally scaled, stateless fleet, behind a DNS record with a short TTL for fast failover," every piece of that sentence should now read as a specific, well-understood decision rather than jargon.
