# I Wanted Codex to Build Small Tools on My Pi, So I Gave It a Workshop

*Part 4 of **One Pi, One SSD, 48 Containers***

A few colleagues and I wanted to watch *Project Hail Mary* in IMAX in Bengaluru. The problem was that new shows were not getting listed, and none of us wanted to spend the day refreshing BookMyShow and District hoping to catch the good seats first.

So I pulled out my phone and gave the problem to my homelab.

A little later, there was a new application running on my Pi.

That is the part I find most exciting: I can have an idea on my phone and end up with a [containerized web tool](#term:containerized-web-tool) deployed to an available [local port](#term:local-port) on the Pi—without [SSHing in](#term:ssh), scaffolding a project or writing a [Dockerfile](#term:dockerfile).

AI ToolHub eventually became the generic open-source **[Agent Console](https://github.com/purva-labs/agent-console)**, but it started with a simple question: *what if my Pi could build the small tools I need, when I need them?*

Today, Agent Console puts a web interface over the [Codex CLI](#term:codex-cli). I plan to extend the same interface to more coding CLIs in the future, while keeping their permissions and runtime behaviour explicit.

That browser interface comes in handy because, even now, there isn't an official Codex desktop app for Linux that I can run on the Pi.

## One interface, three different jobs

I did not want one giant “[agent mode](#term:ai-agent)” with access to everything. Asking a coding question, creating a new application and modifying an existing project are different levels of trust.

- **General** handles questions, coding help and ideas.
- **Tool Builder** turns a prompt into a planned, tested and deployed application.
- **Operator** works on existing projects and explicitly allowed paths.

![Three Agent Console modes feeding different workflows, with Tool Builder moving through planning, implementation, validation and a running container](/api/v2/blog-assets/6a7723316be80cb7842e06d9)

*The three modes share one interface, but Tool Builder is the only path that automatically aims for a running application.*

The interface keeps those boundaries visible instead of hiding them behind one prompt box. These are the views I use most while moving from an idea to a running tool:

<!-- carousel:start -->

![AI ToolHub chat workspace showing the General, Tool Builder and Operator mode selector](/api/v2/blog-assets/6a774d602c0df9470dcf94f1 "Choose the working mode")

*The same composer starts three different workflows; the selected mode decides what kind of work the agent may attempt.*

![AI ToolHub Tool Builder Studio showing sample tool prompts and a structured intake form](/api/v2/blog-assets/6a77515d5cc82fecde67903d "Start with Tool Builder Studio")

*Sample prompts and the structured intake form turn a rough idea into a clearer brief before the build begins.*

![AI ToolHub generated-tools runtime console showing running and failed tools with lifecycle controls](/api/v2/blog-assets/6a774d612c0df9470dcf94fa "Inspect generated tools")

*The runtime console keeps generated tools, ports, status, logs and rebuild controls in one reviewable place.*

![AI ToolHub account view showing a verified Git connection](/api/v2/blog-assets/6a774d612c0df9470dcf94ff "Verify Git integration")

*Git access is connected and verified separately; the temporary device code and account-usage details are excluded from this screenshot.*

![AI ToolHub account view showing the Codex CLI device authorization flow with the one-time code blurred](/api/v2/blog-assets/6a77515e5cc82fecde679046 "Authorize Codex CLI")

*Agent Console exposes the Codex device authorization flow in the web interface; the one-time code is blurred here.*

<!-- carousel:end -->

## Tool Builder is my on-demand mini app factory

The first version was basically: send a prompt to Codex, get files back and hope they worked. Now Tool Builder clarifies the requirement, plans the app, generates it, runs checks, builds the image and verifies the [container](#term:container).

It has become an on-demand mini app factory for the problems that are too small to deserve a full project, but useful enough that I want a working tool *right now*.

## Project Hail Mary was the moment it clicked

Instead of continuing to check manually, I opened Tool Builder on my phone and gave the agent a simple prompt: monitor BookMyShow and District for new English IMAX 2D shows in Bengaluru for my selected date, check every five minutes and alert me as soon as something new goes live.

Before building anything, it asked me a few clarifying questions: which sites it should watch, the exact date, what should count as a match, how often it should check and how I wanted the alert delivered. Once I answered them, it planned the tool, built it and deployed the app on my Pi.

Behind the scenes, the generated app ran a [cron job](#term:cron-job) every five minutes, kept a history of its checks and [fingerprinted](#term:fingerprinting) each show so the same listing would not trigger repeated alerts.

Then the new IMAX shows finally appeared.

The next check picked them up and I got an email with the theatre, screen, show time and availability. Instead of someone in the office eventually noticing a new listing after another random refresh, the tool had been quietly watching it for us the whole time.

That was when Tool Builder stopped feeling like an AI demo. A conversation at work had turned into a prompt on my phone, which turned into a real service running on my Pi, and eventually into the exact alert we were waiting for.

## Operator is for “I need this fixed now”

Tool Builder is for new tools. **Operator** is useful when the problem is already inside one of my existing projects.

If something breaks while I am away from my laptop, I can open Agent Console remotely, point Operator at an allowed project and ask it to inspect the issue, make a small fix and validate the change. I can follow what it is doing instead of handing an unrestricted agent my entire server.

Operator access is [allowlisted](#term:allowlist), but the useful part is simple: I can deal with a small bug from my phone without opening a full development environment.

## Docker Control made updates almost boring

Another repetitive job was container maintenance. Take **Immich**: updating it from the terminal is easy, but jumping into the right [Compose project](#term:docker-compose), pulling the [container image](#term:container-image) and recreating the service every time is still unnecessary friction.

So I built **Docker Control** around those actions.

It groups containers by Compose project and puts state, resource use, ports and logs beside controls for pull, rebuild, start, stop and restart. If Immich has an update, I can open the dashboard and pull the latest image with a button instead of reaching for SSH.

**File Manager** came from the same idea. It gives me quick browser access for small file operations while staying inside a [configured root](#term:configured-root) instead of exposing the whole filesystem.

<!-- carousel:start -->

![Signed-in Docker Control dashboard showing container state and bounded lifecycle actions](/api/v2/blog-assets/6a7736c556ddec232d84b794 "Docker Control")

*Container state and deliberate lifecycle controls.*

![Signed-in File Manager showing the configured root, folders and file actions](/api/v2/blog-assets/6a7736c556ddec232d84b796 "File Manager")

*Only the configured root is visible to the browser.*

<!-- carousel:end -->

## The Pi is starting to feel more like a platform

The biggest change was not adding another AI chat box. It was giving ideas a path from **“I wish I had a tool for this”** to **“it is now running on my Pi.”**

Tool Builder handles new ideas. Operator lets me carefully work on existing projects. Docker Control removes the terminal from common container operations. File Manager handles the small filesystem jobs.

Agent Console, Docker Control and File Manager are available under **[Purva Labs](https://github.com/purva-labs)**. If you try them, I would love to know which parts are actually useful in your setup—and which still get in the way.

The Pi got this homelab surprisingly far, but I now have an HP ProDesk for the next stage. In the next article, I will walk through the migration process: what moved, what stayed on the Pi, what broke and how I kept a rollback path.

---

*Next: **Moving My Homelab from the Pi to an HP ProDesk***
