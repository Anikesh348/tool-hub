This started with a YouTube video, not a rack diagram.

I watched PewDiePie’s video [“I’m DONE with Google”](https://www.youtube.com/watch?v=u_Lxkt50xOg), where he talks about de-Googling and [self-hosting](#term:self-hosting) more of his digital life. I do not remember coming away with a shopping list. What stuck was the simpler idea: a surprising amount of the “cloud” could be replaced by ordinary hardware that I owned.

So I did what any reasonable person does after a video like that: opened too many tabs, read about Raspberry Pis, and told myself I only wanted a shared folder at home.

The first version really was that small. An 8 GB [Raspberry Pi 5](#term:raspberry-pi-5), a 1 TB [SSD](#term:ssd), and three practical goals: keep files in one place, give my photos a private home, and stream media to the devices I already use.

At the time of writing, the same Pi runs 48 [Docker containers](#term:docker-containers). It serves files, stores photos and documents, blocks ads at the [DNS](#term:dns) level, streams media, monitors itself, and hosts tools I have built—including Docker Control, MovieHub and ToolHub. It also runs an [AI agent](#term:ai-agent) through AI ToolHub that can build and deploy small tools on demand.

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

That last row matters. Self-hosted does not automatically mean backed up, redundant or production-grade. It only means I am now the person responsible for answering those questions.

## Small hardware, clear boundaries

I use the SSD for the operating system, application data and bulk files instead of asking a [microSD card](#term:microsd-card) to handle databases, [Docker layers](#term:docker-layers), logs and hundreds of gigabytes of media. The SSD gives the system better [throughput and endurance](#term:storage-throughput-endurance) while keeping the physical setup pleasantly boring: one board and one main disk.

The interesting architecture is in the boundaries around it. Some services run directly on the host, most applications live in [Docker Compose](#term:docker-compose) projects, and [persistent data](#term:persistent-data) sits in deliberately chosen directories. Devices at home connect over the [LAN](#term:lan); my own devices can also reach the Pi through [Tailscale](#term:tailscale).

![Architecture of the Raspberry Pi homelab, showing local and Tailscale access, host services, Docker workloads and the shared SSD](/blogs/raspberry-pi-5-personal-cloud/homelab-overview.png)

*The hardware is small. Separating access, services, containers and persistent data is what keeps it understandable.*

## The first genuinely useful feature: a tiny NAS

The least glamorous part of the homelab may be the part I use most: [Samba](#term:samba).

Samba implements the [SMB file-sharing protocol](#term:smb) used by Windows, macOS and many other clients. On my Pi, it exposes selected folders from the SSD as [network shares](#term:network-shares). My laptop can open media and document folders as if they were attached storage, without the ritual of moving files with a USB drive.

I keep separate shares for media, documents, backups and photos. They do not all receive the same permissions. A service that only needs to inspect a photo directory gets a [read-only mount](#term:read-only-mount); a document workflow that must create and update files receives read-write access.

One of my early, frustrating lessons was a container that could see a directory but could not write to it. The tempting fix was to loosen permissions until the error disappeared. The useful fix was to understand which user the process ran as, correct the ownership, and mount only what it needed.

That small incident changed how I think about the system. [Permissions and ownership](#term:filesystem-permissions) are architecture. “Can this process touch this folder?” is a design decision, not cleanup for later.

## Immich: my photos, on hardware I control

[Immich](#term:immich) is the photo and video service in the setup. Its mobile app backs up photos to the Pi, while the web interface provides albums, search and the familiar feeling of a modern photo library.

It also made the homelab feel real. Immich is not one executable pointed at a folder. My deployment includes the application server, [PostgreSQL](#term:postgresql) for metadata, [Valkey](#term:valkey) for temporary state and job coordination, and a [machine-learning service](#term:machine-learning-service) for features such as visual search.

The original files and the database matter in different ways. A database-only backup does not contain the photos; a copy of the photo directory does not preserve albums and application state.

![Signed-in Immich photo timeline with every private media thumbnail blurred](/blogs/raspberry-pi-5-personal-cloud/immich-photos-signed-in-blurred.png)

*This is the real signed-in timeline. The interface is useful context, but every private media tile is deliberately blurred.*

Today, those originals still live on the same physical SSD as everything else. That is convenient, not ideal. My next storage upgrade is a larger, dedicated [HDD pool](#term:hdd-pool)—most likely mirrored with [RAID](#term:raid)—plus a [separate backup](#term:backup). RAID can keep a library available through a disk failure; it does not protect me from deletion, corruption or losing the whole machine.

## Jellyfin: making the media useful

[Jellyfin](#term:jellyfin) scans the media library, organizes it, tracks playback, and serves it to browsers, phones and TVs.

The request path is straightforward:

1. A media file lives under the shared directory on the SSD.
2. Jellyfin receives that directory as a [container mount](#term:container-mount).
3. It stores its configuration, cache and library metadata separately.
4. A client asks for something to play.
5. Jellyfin sends the original file when the client supports it, or [transcodes](#term:transcoding) it when it does not.

That final step became interesting enough to create another project. A Pi 5 can handle several [direct-play streams](#term:direct-play) surprisingly well, but live video conversion is expensive. I built an offline optimization workflow that prepares files in browser-friendly formats before somebody presses Play, reducing the chance that four CPU cores have to perform heroics during movie night.

![Signed-in Jellyfin-style home page populated with a fictional demo catalog](/blogs/raspberry-pi-5-personal-cloud/jellyfin-home-fictional-demo.png)

*This public screenshot preserves the signed-in interface but replaces my library with a fictional demo catalog. It shows the product without publishing private viewing history or recognizable commercial artwork.*

Jellyfin also exposed the next boring bottleneck: manual file management. That led to the [Radarr, Sonarr, Prowlarr and Bazarr stack](#term:media-automation-stack), and eventually my own MovieHub request and approval workflow. I will unpack that system in Part 3.

## Docker turned a device into a platform

Docker is what let the setup grow without turning every installation into a negotiation over ports, dependencies and runtime versions. Containers share the [host's Linux kernel](#term:linux-kernel), so they are lightweight enough for an 8 GB Pi, while Compose lets me define each application with its networks, mounts, environment and [health checks](#term:health-checks).

The count reached 48 because useful applications bring supporting services. Immich needs a database, cache and machine-learning worker. AI ToolHub has a [frontend and backend](#term:frontend-backend), [MongoDB](#term:mongodb), [Codex runtime](#term:codex-runtime) and browser worker. Monitoring has agents, dashboards and metric stores.

The important unit is not a container. It is a capability I can understand, update and recover.

That became most valuable when I stopped only installing other people's software and started building my own:

- **Docker Control** gives me a focused interface for the container operations I use regularly. From one screen I can start, stop or restart a container, pull its latest image, rebuild it, and follow its logs without dropping into SSH.
- **File Manager** lets me browse files across the Pi and upload files directly from any device.
- **ToolHub** puts my personal utilities and server applications behind one home page.
- **MovieHub** adds registration, access requests and admin approval to the media workflow.
- **AI ToolHub** gives Codex CLI a self-hosted web interface where an agent can chat, generate a tool and deploy it to the Pi.

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

Some are essential, some are conveniences, and some are experiments waiting for me to admit I have not opened them in months. A homelab is allowed to be useful and slightly untidy at the same time.

## Watching the machine that runs everything

Once several services depended on the Pi, “it seems fine” stopped being a useful health check. That is where [observability](#term:observability) became practical rather than theoretical.

[Netdata](https://www.netdata.cloud/) gives me a live view of CPU, memory, disk activity, networking, processes and containers. Beszel provides a calmer system overview, Gatus checks important endpoints, and Dozzle makes container logs easier to inspect.

![Netdata dashboard showing live metrics from pi-purva](/blogs/raspberry-pi-5-personal-cloud/netdata-pi-dashboard.png)

*The gauges are not the point. The value is connecting a slow application to CPU, memory, disk or network pressure.*

## The storage diagram is also the risk diagram

The applications look separate in a browser, but most roads lead back to one SSD.

![Data flow from phones, TVs and laptops through Immich, Jellyfin and Samba to the shared SSD](/blogs/raspberry-pi-5-personal-cloud/storage-data-flow.png)

That makes the system easy to understand, but it also means a nearly full or failed disk can affect many services at once. Application configuration and bulk data need different backup strategies. Databases need [application-aware backups](#term:application-aware-backups). Containers should receive only the mounts they need. RAID, [replication](#term:replication) and backup solve different problems.

Those are not flaws I want to hide behind an architecture diagram. They are the next items on the roadmap.

## What this small machine taught me

The visible result is useful: shared files, a private photo library, media on every device, monitoring dashboards and my own tools running without my laptop being awake.

Running it day to day also made a few practices non-negotiable:

- decide where persistent data lives before deploying a service;
- define how each service can be accessed;
- collect logs and metrics from the start;
- plan backups around restoring the data;
- reconsider the architecture when a constraint keeps causing problems.

These habits came from ordinary failures: a phone that could not reach a service, a container with read access but no write permission, or several workloads competing for CPU and memory. In each case, the problem was easier to fix once the network path, permissions, logs and metrics were visible.

That has been the useful part of homelabbing for me: I get to practise operating a real system at a manageable scale.

## The next problem: access

Everything above works nicely at home. Tailscale also lets my personal devices reach the Pi while I am away without exposing a collection of [router ports](#term:router-port-forwarding).

Then I wanted selected services to work for friends and family. Asking everyone to join my private device network was not the experience I wanted, but directly exposing the Pi was not acceptable either. [Cloudflare Tunnel](#term:cloudflare-tunnel) looked promising; media and photo workloads introduced different trade-offs.

My answer became a public [VPS](#term:vps) running [Caddy](#term:caddy), connected to the Pi through an encrypted [WireGuard tunnel](#term:wireguard), with [Cloudflare DNS](#term:cloudflare-dns) and a custom [authentication gateway](#term:authentication-gateway) protecting sensitive routes.

The domain name came from a much less technical decision. I live in a society called Purva, and the services were being hosted from there. `hostingfrompurva.xyz` was too literal not to use.

That request path—and the decisions behind it—is Part 2. If you run a homelab too, I would genuinely like to hear which “one useful service” started yours, and what it turned into.

---

*Next: **How I Put My Homelab on the Internet Without Exposing My Home Network***
