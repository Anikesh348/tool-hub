const pathContent = {
  public: {
    number: "PATH 01",
    title: "A public request, end to end",
    description: "The VPS is the only public edge. Traffic enters the home network through an encrypted tunnel and terminates at the intended application.",
    aria: "Public request path",
    steps: [
      ["01", "Client", "Browser", "HTTPS request", "STEP 01 / CLIENT", "The request starts in a normal browser.", "A user opens a public application over HTTPS. Routes that expose personal or operational data require authentication before they continue.", ["Browser", "HTTPS", "OAuth where required"]],
      ["02", "Discovery", "Cloudflare DNS", "Domain → VPS", "STEP 02 / DISCOVERY", "DNS points to the public gateway.", "Cloudflare is authoritative for the domain. Public records resolve to the VPS—not to my residential connection or either homelab node.", ["Cloudflare DNS", "Stable endpoint", "No home IP"]],
      ["03", "Public edge", "VPS gateway", "Caddy · TLS · auth", "STEP 03 / PUBLIC EDGE", "TLS terminates outside my house.", "Caddy handles certificates, host and route matching, security headers, and authentication checks on a small internet-facing VPS.", ["Caddy", "TLS", "Route policy"]],
      ["04", "Private transit", "WireGuard", "Encrypted tunnel", "STEP 04 / TRANSIT", "Only intended traffic crosses the tunnel.", "The VPS and homelab share a private WireGuard network. Requests travel over that encrypted path without residential port-forwarding.", ["WireGuard", "Private address space", "Encrypted"]],
      ["05", "Application", "Ubuntu + Docker", "NGINX → service", "STEP 05 / APPLICATION", "The request reaches one application.", "NGINX routes the request to the intended Docker service on the Ubuntu production VM. The application owns its final authorization and response.", ["Ubuntu", "NGINX", "Docker Compose"]]
    ]
  },
  data: {
    number: "PATH 02",
    title: "Data follows its performance profile",
    description: "Latency-sensitive state stays beside compute. Large files move across the LAN to the Raspberry Pi, which remains the bulk-data authority.",
    aria: "Data and storage path",
    steps: [
      ["01", "Workload", "Application", "Reads or writes", "STEP 01 / WORKLOAD", "The application decides what kind of state it needs.", "Structured state, cache entries, photos, and large media have different latency and durability needs, so they do not share one storage strategy.", ["Service boundary", "Data ownership"]],
      ["02", "Fast state", "Local databases", "NVMe · cache", "STEP 02 / FAST STATE", "Databases stay close to compute.", "PostgreSQL, MongoDB, Redis, SQLite configuration, and other latency-sensitive state remain on the Ubuntu node's local storage.", ["Local NVMe", "PostgreSQL", "Redis"]],
      ["03", "LAN transport", "NFS client", "Mounted dependency", "STEP 03 / LAN TRANSPORT", "Bulk data crosses a deliberate mount boundary.", "Services that need photos, media, or backups consume explicit NFS mounts over the home LAN rather than placing live databases on network storage.", ["NFS", "LAN", "Mount health"]],
      ["04", "Authority", "Raspberry Pi", "SSD · NFS · SMB", "STEP 04 / STORAGE NODE", "The Pi is authoritative for bulk data.", "The Raspberry Pi manages the attached SSD and serves scoped datasets through NFS and SMB to applications and household clients.", ["Raspberry Pi", "SSD", "NFS", "SMB"]],
      ["05", "Recovery", "Backup sets", "Copies · checks", "STEP 05 / RECOVERY", "Recovery is part of the data path.", "Backups and recovery procedures are kept separate from primary application state, with mount and capacity signals included in platform monitoring.", ["Backups", "Capacity alerts", "Recovery"]]
    ]
  },
  ops: {
    number: "PATH 03",
    title: "Operations use a separate control plane",
    description: "Management agents run in dedicated guests, reach approved targets over a private mesh, and leave the Proxmox hypervisor focused on virtualization.",
    aria: "Operations and management path",
    steps: [
      ["01", "Operator", "Approved action", "Intent + scope", "STEP 01 / OPERATOR", "An operation starts with a bounded request.", "Diagnostics and changes begin with an explicit target and scope instead of arbitrary fleet-wide shell access.", ["Scoped intent", "Human approval"]],
      ["02", "Private access", "Tailscale mesh", "Identity-aware link", "STEP 02 / PRIVATE ACCESS", "Management traffic stays off the public web.", "Tailscale provides the private management network used by the dedicated agent VMs and monitored hosts.", ["Tailscale", "Private mesh", "Device identity"]],
      ["03", "Control plane", "Management VMs", "Codex · Claude", "STEP 03 / CONTROL PLANE", "Automation runs beside production.", "Dedicated Codex and Claude guests hold management tooling. General-purpose automation is not installed on the Proxmox host.", ["Isolated guests", "Smaller blast radius"]],
      ["04", "Execution", "Allowlisted targets", "SSH · APIs", "STEP 04 / EXECUTION", "Each target exposes a deliberate interface.", "Approved hosts are reached through scoped identities, SSH aliases, application APIs, and task-specific controls rather than one public admin surface.", ["Allowlists", "SSH", "Service APIs"]],
      ["05", "Feedback", "Health signals", "Metrics · probes · logs", "STEP 05 / FEEDBACK", "Every operation ends with verification.", "Container health, host metrics, endpoint probes, and browser-visible behavior confirm whether the intended state was actually reached.", ["Prometheus", "Gatus", "Logs", "SSE"]]
    ]
  }
};

const decisions = {
  storage: ["DECISION / STORAGE", "Databases stay local. Bulk data travels.", "Latency-sensitive databases and configuration live on the compute node's local disk. The Raspberry Pi remains the authoritative NFS storage node for photos, media, and backups.", "The storage node can still affect dependent apps, so mounts and startup order are monitored explicitly."],
  edge: ["DECISION / INGRESS", "The public IP belongs to a VPS, not my router.", "A small VPS terminates HTTPS and sends approved traffic over WireGuard. This keeps DNS and certificates stable while avoiding direct residential port exposure.", "There is one more machine to operate, but it creates a clean and controllable public boundary."],
  access: ["DECISION / CONTROL PLANE", "Automation is isolated from the hypervisor.", "Dedicated management guests use a private mesh and scoped identities to reach only the systems they operate. Proxmox stays focused on virtualization.", "The extra VMs consume limited capacity, but the smaller blast radius is worth it."],
  failure: ["DECISION / RELIABILITY", "A degraded platform should still be diagnosable.", "Independent probes, host metrics, container health checks, and recovery-aware startup sequencing distinguish a failed app from a failed mount or node.", "The system favors clear recovery over pretending a two-node lab has cloud-level redundancy."]
};

const architectureStage = document.querySelector(".architecture-stage");
const pathTabs = [...document.querySelectorAll(".path-tab")];

function renderStep(step, index) {
  document.querySelectorAll(".flow-step").forEach((item, itemIndex) => item.classList.toggle("is-selected", itemIndex === index));
  document.querySelector("#detail-kicker").textContent = step[4];
  document.querySelector("#detail-title").textContent = step[5];
  document.querySelector("#detail-copy").textContent = step[6];
  document.querySelector("#detail-tags").innerHTML = step[7].map(tag => `<li>${tag}</li>`).join("");
}

function selectPath(path) {
  const content = pathContent[path];
  architectureStage.dataset.activePath = path;
  pathTabs.forEach(tab => {
    const active = tab.dataset.path === path;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#flow-number").textContent = content.number;
  document.querySelector("#flow-title").textContent = content.title;
  document.querySelector("#flow-description").textContent = content.description;
  const flowSteps = document.querySelector("#flow-steps");
  flowSteps.setAttribute("aria-label", content.aria);
  flowSteps.innerHTML = content.steps.map((step, index) => `
    <button class="flow-step${index === 0 ? " is-selected" : ""}" data-step-index="${index}" aria-label="Step ${step[0]}: ${step[2]}">
      <span class="flow-step-number">${step[0]}<i></i></span>
      <small>${step[1]}</small>
      <strong>${step[2]}</strong>
      <em>${step[3]}</em>
    </button>`).join("");
  flowSteps.querySelectorAll(".flow-step").forEach(button => button.addEventListener("click", () => renderStep(content.steps[Number(button.dataset.stepIndex)], Number(button.dataset.stepIndex))));
  renderStep(content.steps[0], 0);
}

pathTabs.forEach(tab => tab.addEventListener("click", () => selectPath(tab.dataset.path)));
selectPath("public");

document.querySelectorAll(".filter-chip").forEach(chip => chip.addEventListener("click", () => {
  const filter = chip.dataset.filter;
  document.querySelectorAll(".filter-chip").forEach(item => {
    const active = item === chip;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".project-card").forEach(card => {
    card.classList.toggle("is-hidden", filter !== "all" && !card.dataset.category.split(" ").includes(filter));
  });
}));

document.querySelectorAll(".decision-tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".decision-tab").forEach(item => {
    const active = item === tab;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", String(active));
  });
  const [kicker, title, copy, tradeoff] = decisions[tab.dataset.decision];
  document.querySelector(".decision-detail .detail-kicker").textContent = kicker;
  document.querySelector("#decision-title").textContent = title;
  document.querySelector("#decision-copy").textContent = copy;
  document.querySelector("#decision-tradeoff").textContent = tradeoff;
}));

document.querySelectorAll("[data-open-path]").forEach(button => button.addEventListener("click", () => {
  selectPath(button.dataset.openPath);
  document.querySelector("#architecture").scrollIntoView({ behavior: "smooth" });
}));
