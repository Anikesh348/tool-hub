This started with a YouTube video, not a rack diagram.

I watched PewDiePie’s video [“I’m DONE with Google”](https://www.youtube.com/watch?v=u_Lxkt50xOg), where he talks about de-Googling and [self-hosting](#term:self-hosting) more of his digital life. I do not remember coming away with a shopping list. What stuck was the simpler idea: a surprising amount of the “cloud” could be replaced by ordinary hardware that I owned.

So I did what any reasonable person does after a video like that: opened too many tabs, read about Raspberry Pis, and told myself I only wanted a shared folder at home.

The first version really was that small: an 8 GB [Raspberry Pi 5](#term:raspberry-pi-5), a 1 TB [SSD](#term:ssd), and three goals—keep files in one place, give my photos a private home, and stream media to my devices.

At the time of writing, the same Pi runs 48 [Docker containers](#term:docker-containers). It handles files, photos, media, [DNS](#term:dns)-level ad blocking, monitoring and tools I built—including Docker Control, MovieHub and ToolHub. Through AI ToolHub, an [AI agent](#term:ai-agent) can generate a small tool, expose it through ToolHub and deploy it as a container.

Apparently, “one useful service” is how a small computer acquires the responsibilities of an IT department.

## The system at a glance

| | My current setup |
| --- | --- |
| Computer | Raspberry Pi 5, 8 GB [RAM](#term:ram), four [ARM CPU cores](#term:arm-cpu) |
| Operating system | [Debian 13](#term:debian) |
| Main storage | 1 TB SSD |
| Workloads | 48 Docker containers at the time of writing |
| Main uses | [NAS](#term:nas), photo library, media server, monitoring and personal tools |
| Stored data | About 612 GB media, 62 GB documents and 32 GB photos |
| Current constraint | Roughly 88% disk usage and one physical drive |

Getting 48 containers to run was the visible milestone. The harder work was deciding where persistent state lived, which processes could touch it, how each service was reached, how failures became visible, and what I would eventually need to recover.

That last part is unfinished. Self-hosted does not automatically mean backed up or redundant; it makes those questions my responsibility.

## Small hardware, clear boundaries

The SSD holds the operating system, application data and bulk files, sparing a [microSD card](#term:microsd-card) from databases, [Docker layers](#term:docker-layers), logs and hundreds of gigabytes of media. It provides better [throughput and endurance](#term:storage-throughput-endurance) while keeping the setup pleasantly boring: one board and one main disk.

The architecture is in the boundaries around it. Some services run on the host, most live in [Docker Compose](#term:docker-compose) projects, and [persistent data](#term:persistent-data) has deliberately chosen directories. Devices connect over the [LAN](#term:lan) or, for my own remote access, through [Tailscale](#term:tailscale).

![Architecture of the Raspberry Pi homelab, showing local and Tailscale access, host services, Docker workloads and the shared SSD](/blogs/raspberry-pi-5-personal-cloud/homelab-overview.png)

*The hardware is small. Separating access, services, containers and persistent data is what keeps it understandable.*

## The first genuinely useful feature: a tiny NAS

The least glamorous part of the homelab may be the part I use most: [Samba](#term:samba).

Samba exposes selected SSD folders as [network shares](#term:network-shares) over the [SMB protocol](#term:smb), so my laptop can open them without the ritual of moving files with a USB drive.

Media, documents, backups and photos have separate shares and permissions. A service that only inspects photos gets a [read-only mount](#term:read-only-mount); a document workflow that updates files gets read-write access.

One container could see a directory but not write to it. Instead of loosening permissions until the error disappeared, I found its process user, corrected the ownership, and mounted only what it needed.

That incident changed how I think about the system. [Permissions and ownership](#term:filesystem-permissions) are architecture. “Can this process touch this folder?” is a design decision, not cleanup for later.

## Immich: my photos, on hardware I control

[Immich](#term:immich) backs up photos from my phone to the Pi and provides albums, search and a modern photo library.

It also made the homelab feel real. My deployment is not one executable pointed at a folder: it includes the application server, [PostgreSQL](#term:postgresql) for metadata, [Valkey](#term:valkey) for temporary state and job coordination, and a [machine-learning service](#term:machine-learning-service) for visual search.

The files contain the photos; the database preserves albums and application state. I need both to recover the library properly.

![Signed-in Immich photo timeline with every private media thumbnail blurred](/blogs/raspberry-pi-5-personal-cloud/immich-photos-signed-in-blurred.png)

*This is the real signed-in timeline. The interface is useful context, but every private media tile is deliberately blurred.*

Those originals still live on the same SSD as everything else. I plan to add a larger [HDD pool](#term:hdd-pool), most likely mirrored with [RAID](#term:raid), plus a [separate backup](#term:backup). RAID can preserve availability through a disk failure; it does not cover deletion, corruption or losing the machine.

## Jellyfin: making the media useful

[Jellyfin](#term:jellyfin) organizes the media library, tracks playback, and serves browsers, phones and TVs.

The request path is straightforward:

1. A media file lives under the shared directory on the SSD.
2. Jellyfin receives that directory as a [container mount](#term:container-mount).
3. It stores its configuration, cache and library metadata separately.
4. A client asks for something to play.
5. Jellyfin sends the original file when the client supports it, or [transcodes](#term:transcoding) it when it does not.

That final step became another project. A Pi 5 handles several [direct-play streams](#term:direct-play) surprisingly well, but live conversion is expensive. My offline workflow prepares browser-friendly files before somebody presses Play, reducing the chance that four CPU cores have to perform heroics during movie night.

![Signed-in Jellyfin-style home page populated with a fictional demo catalog](/blogs/raspberry-pi-5-personal-cloud/jellyfin-home-fictional-demo.png)

*This public screenshot preserves the signed-in interface but replaces my library with a fictional demo catalog. It shows the product without publishing private viewing history or recognizable commercial artwork.*

Jellyfin exposed another boring bottleneck: manual file handling. I automated library indexing, requests, subtitles and file preparation using the [Radarr, Sonarr, Prowlarr and Bazarr stack](#term:media-automation-stack). That led to MovieHub, which I will unpack in Part 3.

## Docker turned a device into a platform

Docker let the setup grow without every installation becoming a negotiation over ports, dependencies and runtime versions. Containers share the [host's Linux kernel](#term:linux-kernel), while Compose defines each application’s networks, mounts, environment and [health checks](#term:health-checks).

The count reached 48 because applications bring supporting services. Immich needs a database, cache and machine-learning worker. AI ToolHub has a [frontend and backend](#term:frontend-backend), [MongoDB](#term:mongodb), [Codex runtime](#term:codex-runtime) and browser worker. The useful unit is the capability—and whether I can update and recover it.

That became most valuable when I stopped only installing other people's software and started building my own:

- **Docker Control** reduces repetitive operational work to a focused set of container actions. I can start, stop, restart, update or rebuild a container and inspect its logs without giving every routine task a full SSH session.
- **File Manager** solves the less glamorous problem of securely reaching and transferring files across my devices, without relying on a USB drive or a broadly writable share.
- **ToolHub** gives personal utilities and server applications one authenticated entry point instead of a collection of ports and bookmarks.
- **MovieHub** adds users, requests, approvals and workflow state around the media server rather than placing that coordination inside Jellyfin.
- **AI ToolHub** coordinates a Codex agent, generated source code, execution and container deployment from a browser. Tool Builder can generate a small tool, add it to ToolHub and deploy it to the Pi; a concrete walkthrough belongs in Part 4.

![Docker Control showing the ToolHub Compose group, container actions and filtered frontend logs](/blogs/raspberry-pi-5-personal-cloud/docker-control-container-logs.jpg)

*Docker Control puts container state, routine actions and live logs in one place. The log view is filtered to a harmless startup sequence for this public screenshot.*

![Signed-in ToolHub home page showing personal tools and server applications](/blogs/raspberry-pi-5-personal-cloud/toolhub-signed-in.png)

*ToolHub is where the homelab started looking less like a list of containers and more like a platform built around my own needs.*

![Signed-in AI ToolHub chat workspace showing General, Tool Builder and Operator modes](/blogs/raspberry-pi-5-personal-cloud/ai-toolhub-chat-signed-in.png)

*AI ToolHub gives Codex CLI a browser workspace on Linux. General, Tool Builder and Operator modes will get a proper walkthrough in Part 4.*

This progression—from using open-source projects, to extending them, to building tools around my own annoyances—is the real center of the homelab for me. A side project on a laptop can remain a demo. A side project that runs every day has to deal with users, authentication, upgrades, failures, storage and recovery. It becomes a much better teacher.

## What else runs on it

Here is the condensed service map:

| Area | Services and projects |
| --- | --- |
| Core infrastructure | Samba, [Pi-hole](#term:pi-hole), Tailscale, Caddy |
| Photos and media | Immich, Jellyfin |
| Media automation | Radarr, Sonarr, Prowlarr, Bazarr, Lidarr, qBittorrent, Gluetun, FlareSolverr |
| Monitoring | [Netdata, Beszel, Gatus, Prometheus, Grafana and Dozzle](#term:monitoring-stack) |
| Utilities | File Browser, my file manager |
| Projects I built | ToolHub, AI ToolHub, Docker Control, This Day, Wavelength, Movie Monitor, YouTube Downloader |

Some are essential; others are experiments waiting for me to admit I have not opened them in months. A homelab is allowed to be useful and slightly untidy at the same time.

## Watching the machine that runs everything

Once several services depended on the Pi, “it seems fine” stopped being a useful health check. [Observability](#term:observability) became practical rather than theoretical.

[Netdata](https://www.netdata.cloud/) shows CPU, memory, disk, networking, processes and containers. Beszel provides a calmer overview, Gatus checks endpoints, and Dozzle makes logs easier to inspect. Together, they connect a failed request to the service, resource or dependency behind it.

![Netdata dashboard showing live metrics from pi-purva](/blogs/raspberry-pi-5-personal-cloud/netdata-pi-dashboard.png)

*The gauges are not the point. The value is connecting a slow application to CPU, memory, disk or network pressure.*

## The storage diagram is also the risk diagram

The applications look separate in a browser, but most roads lead back to one SSD.

![Data flow from phones, TVs and laptops through Immich, Jellyfin and Samba to the shared SSD](/blogs/raspberry-pi-5-personal-cloud/storage-data-flow.png)

That makes the system easy to understand, but a nearly full or failed disk can affect many services at once. Application configuration and bulk data need different recovery plans; databases need [application-aware backups](#term:application-aware-backups), and RAID, [replication](#term:replication) and backup solve different problems.

Those are not flaws I want to hide behind an architecture diagram. They are the next items on the roadmap.

## What this small machine taught me

The visible result is useful: shared files, a private photo library, media on every device, monitoring dashboards and my own tools running without my laptop being awake.

Operating it made a few practices non-negotiable:

- define service boundaries and authentication before widening access;
- decide where state lives and which process can change it;
- add health checks, logs and metrics so failures become diagnosable;
- make deployment and upgrades repeatable;
- plan backups by working backwards from recovery.

These lessons came from ordinary failures: a phone that could not reach a service, a container with read access but no write permission, or several workloads competing for CPU and memory. Each became easier to reason about once the access path, ownership boundary and system state were visible.

That has been the useful part of homelabbing for me: it turns authentication, state management, observability, failure handling, deployment and recovery into real decisions, but at a scale where I can still understand the whole system.

## The next problem: access

Everything above works nicely at home. Tailscale also lets my personal devices reach the Pi while I am away without exposing a collection of [router ports](#term:router-port-forwarding).

Private access through Tailscale worked for me, but friends and family needed something simpler than joining my device network. Directly exposing the Pi was not acceptable. [Cloudflare Tunnel](#term:cloudflare-tunnel) looked promising; media and photo workloads introduced different trade-offs.

That constraint led to a public [VPS](#term:vps) running [Caddy](#term:caddy), connected to the Pi through an encrypted [WireGuard tunnel](#term:wireguard), with [Cloudflare DNS](#term:cloudflare-dns) and a custom [authentication gateway](#term:authentication-gateway) protecting sensitive routes.

The domain name came from a much less technical decision. I live in a society called Purva, and the services were being hosted from there. `hostingfrompurva.xyz` was too literal not to use.

Part 2 follows that request path from the public internet to the Pi, and the decisions that kept my home network out of it. If you run a homelab too, I would genuinely like to hear which “one useful service” started yours, and what it turned into.

---

*Next: **How I Put My Homelab on the Internet Without Exposing My Home Network***
