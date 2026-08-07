> **Learning goal**
> Establish exactly what the platform does today, why it exists, and where its authority ends.

## 1.1 The problem this architecture solves

ToolHub needs AI intelligence in more than one feature: a central assistant, contextual course explanations, and future project-specific tools. Calling a provider CLI directly from every feature would duplicate credentials, provider logic, error handling and security policy. Exposing a CLI itself would be even more dangerous because application requests would reach a management machine without a stable contract or permission boundary.

The integration therefore separates application behavior from provider execution. ToolHub owns its users, interfaces and persistent history. A reusable gateway owns the provider-facing REST contract and request security, one instance per provider. A private executor on a dedicated low-blast-radius VM is the only service allowed to launch that provider's CLI.

**As of 2026-08-05 this is no longer a single-provider system.** Codex remains the preferred provider, but ToolHub now also runs a Claude gateway/executor pair built to the identical contract, and a provider router inside the ToolHub backend automatically fails over to Claude when Codex reports its usage allowance is exhausted. Section 1.7 and Lesson 6 cover the routing behavior; the rest of this lesson still applies to either provider individually.

The resulting path is:

```text
ToolHub UI
  -> ToolHub FastAPI backend on ubuntu-purva
  -> Provider router (in-process, Redis-backed pin)
       -> Codex gateway on ubuntu-purva  -> Codex executor on hp-codex   -> codex exec
       -> Claude gateway on ubuntu-purva -> Claude executor on hp-claude -> claude
```

## 1.2 Current capability profiles

The public application contract currently accepts two profiles.

| Profile | Intended use | Available intelligence | Explicitly unavailable |
| --- | --- | --- | --- |
| `knowledge-only` | Course explanations and supplied-document questions | Model knowledge plus text context supplied by the application | Live server state, shell, files, network, web search, tools and writes |
| `read-only` | ToolHub’s general admin assistant | General answers, current public web search, and bounded runtime snapshots for `ubuntu-purva` and the executor host answering the request (`hp-codex` or `hp-claude`) | Shell commands executed by the model, file access, SSH, service control, writes, approval escalation and interactive browser control |

Course questions deliberately use `knowledge-only`. The course backend supplies the lesson context, so the model does not need infrastructure access. The central assistant uses `read-only`, allowing questions such as “what is my CPU usage?” to be answered from trusted snapshots without giving the model a shell.

Both profiles are provider-neutral: the capability name and its enforcement are identical whether the request lands on Codex or Claude. An application never chooses the provider directly — it chooses the profile, and the router (1.7) chooses which provider serves it.

## 1.3 What “read-only” really means

Read-only is not an unrestricted Codex session with polite instructions. Enforcement is layered:

- shell tooling is disabled;
- the permission profile denies the filesystem root and enables only minimal/workspace reads;
- application tools, plugins, hooks, memories, goals, multi-agent operation, browser and computer control are disabled;
- approval policy is fixed to `never`;
- the CLI starts with strict, ignored-user configuration so personal settings cannot silently widen authority;
- server state arrives as generated text snapshots, not through arbitrary command execution.

The snapshots contain a narrow set of fields: capture time, hostname, CPU percentage, load averages, memory, root-disk use, uptime and failed systemd units. They are observations, not an action interface.

## 1.4 Other platform capabilities

The implemented platform also provides:

- persistent ToolHub chat history and course questions in MongoDB;
- conversation continuation per provider using an opaque provider thread ID (a chat can hold a live Codex thread and a live Claude thread at once — see 6.3);
- automatic failover from Codex to Claude when Codex’s usage allowance is exhausted, without the user noticing anything beyond which provider answered;
- contextual questions from highlighted text or the currently open module;
- current public web answers through the read-only profile;
- independent gateway identities, secrets, scopes and optional source CIDRs, one registry per provider so applications can be added without touching either provider’s VM;
- HMAC request authentication and replay prevention on every private hop, for every provider;
- bounded request, context, prompt, response and timeout limits, tuned per provider gateway;
- one active run at a time per gateway, returning controlled `429` busy responses;
- normalized provider errors and correlation request IDs;
- gateway audit metadata without storing application prompts or answers;
- private health/readiness endpoints and hardened systemd services for every gateway and executor.

## 1.5 Deliberate non-goals

**Scope note:** everything below is a statement about *ToolHub's* two profiles, `knowledge-only` and `read-only`. It is not a claim about every AI capability running on this infrastructure — 7.6a documents a third, `operator`, profile that ToolHub's application contract never requests and cannot reach, used only by the separate ops-scheduler system. Keep the two apart: this section is “what can the browser, through ToolHub, ever cause,” not “what can this Codex/Claude deployment do anywhere.”

Today ToolHub is not an autonomous operations agent. Through `knowledge-only` or `read-only`, it cannot restart a service, edit a file, install software, SSH to another host, approve a change or run an arbitrary diagnostic command. It does not stream tokens, accept image/file context, run several provider jobs concurrently, or expose either provider through public ingress. It also does not let the caller pick a provider or model per request — that choice is made for it by the router’s usage-exhaustion logic, not by request metadata, so an application cannot be tricked into calling a specific provider by claiming the other is down.

Those boundaries are valuable, and — as 7.6a shows — dropping them is not a hypothetical: a write-capable, full-shell `operator` profile already exists elsewhere on this same infrastructure, with its own reviewed-enough-for-a-single-operator-homelab tradeoffs. It was built as its own capability profile, its own gateway pair and its own executor pair rather than as a relaxation of `read-only` — which is the one part of the “don't just remove restrictions” principle it did follow. Whether it satisfies the rest (7.7) is worth reading honestly, not assuming.

## 1.6 Capability decision table

| Example request | Profile/path | Expected behavior |
| --- | --- | --- |
| “What is NFS?” | General assistant, read-only | Answer directly |
| “Any cricket matches running?” | General assistant, read-only | Use current public web search |
| “What is my CPU usage?” | General assistant, read-only | Report trusted host snapshots and name each host |
| “Explain this UID paragraph” | Course, knowledge-only | Use highlighted passage and lesson context |
| “What does this module say about NFS identity?” | Course, knowledge-only | Retrieve relevant parts of the open module |
| “Restart Docker” | Read-only | Refuse the action and explain the boundary |
| Codex reports its usage allowance is finished mid-conversation | Either capability | Router pins the app to Claude for up to a day; the same request is retried against Claude before the user sees an error |

## 1.7 Multi-provider failover

Codex is still the preferred provider — it is tried first on every request. But Codex CLI usage is a finite daily/weekly/monthly allowance, and a management VM with a single 2 vCPU executor has no room to queue around an exhausted account. Rather than surface that as a user-facing outage, ToolHub’s provider router (`ai_provider_router.py`, backend-python) does the following:

1. Try the currently active provider first (Codex, unless a pin says otherwise).
2. If the gateway reports a usage-exhaustion error — a specific error code such as `provider_usage_exhausted`, or a message containing a marker like “usage limit”, “quota” or “credit balance” — treat it as exhausted, not as a generic failure, and retry the same request against Claude.
3. If Claude answers, record a pin in Redis (`ai:active-provider`, default one-day TTL) so every ToolHub backend worker routes new requests straight to Claude without re-probing a dead Codex account on every call.
4. If Claude is also exhausted, clear the pin and raise `429 provider_usage_exhausted` — the pin is not worth keeping when neither provider can serve, since the next request should try Codex fresh rather than wait out a TTL on a provider that already failed too.

Two failure classes are deliberately **not** treated as exhaustion: `gateway_busy` and `executor_busy`. Both gateway and executor allow only one run at a time (4.6), so ordinary concurrency contention must never accidentally pin the whole application onto the fallback provider — that would silently move all traffic to Claude just because two admins asked questions at the same moment.

Because Codex and Claude conversation threads are provider-specific opaque IDs, a chat that fails over starts a fresh thread on Claude rather than replaying a Codex thread ID that Claude cannot resolve (6.3). This is a routing decision made once per request, inside the ToolHub backend, before any signed request leaves the process — the gateways themselves have no knowledge of each other or of the fallback policy.

> **Review question**
> Why is “read-only intelligence built from trusted snapshots” safer than letting the model run any command that appears harmless? And separately: why must `gateway_busy` never be classified as usage-exhausted by the router?
