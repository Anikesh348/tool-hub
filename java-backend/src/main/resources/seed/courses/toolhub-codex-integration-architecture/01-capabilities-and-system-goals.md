> **Learning goal**
> Establish exactly what the platform does today, why it exists, and where its authority ends.

## 1.1 The problem this architecture solves

ToolHub needs AI intelligence in more than one feature: a central assistant, contextual course explanations, and future project-specific tools. Calling Codex directly from every feature would duplicate credentials, provider logic, error handling and security policy. Exposing the Codex CLI itself would be even more dangerous because application requests would reach a management machine without a stable contract or permission boundary.

The integration therefore separates application behavior from provider execution. ToolHub owns its users, interfaces and persistent history. A reusable gateway owns the provider-facing REST contract and request security. A private executor on `hp-codex` is the only service allowed to launch the Codex CLI.

The resulting path is:

```text
ToolHub UI
  -> ToolHub FastAPI backend on ubuntu-purva
  -> Codex gateway on ubuntu-purva
  -> Codex executor on hp-codex
  -> codex exec
```

## 1.2 Current capability profiles

The public application contract currently accepts two profiles.

| Profile | Intended use | Available intelligence | Explicitly unavailable |
| --- | --- | --- | --- |
| `knowledge-only` | Course explanations and supplied-document questions | Model knowledge plus text context supplied by the application | Live server state, shell, files, network, web search, tools and writes |
| `read-only` | ToolHub’s general admin assistant | General answers, current public web search, and bounded runtime snapshots for `ubuntu-purva` and `hp-codex` | Shell commands executed by the model, file access, SSH, service control, writes, approval escalation and interactive browser control |

Course questions deliberately use `knowledge-only`. The course backend supplies the lesson context, so the model does not need infrastructure access. The central assistant uses `read-only`, allowing questions such as “what is my CPU usage?” to be answered from trusted snapshots without giving the model a shell.

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
- Codex conversation continuation using an opaque provider thread ID;
- contextual questions from highlighted text or the currently open module;
- current public web answers through the read-only profile;
- independent gateway identities, secrets, scopes and optional source CIDRs for future applications;
- HMAC request authentication and replay prevention;
- bounded request, context, prompt, response and timeout limits;
- one active run at a time, returning controlled `429` busy responses;
- normalized provider errors and correlation request IDs;
- gateway audit metadata without storing application prompts or answers;
- private health/readiness endpoints and hardened systemd services.

## 1.5 Deliberate non-goals

Today this is not an autonomous operations agent. It cannot restart a service, edit a file, install software, SSH to another host, approve a change or run an arbitrary diagnostic command. It does not stream tokens, accept image/file context, run several Codex jobs concurrently, select different models per request, or expose Codex through public ingress.

Those boundaries are valuable. A future write-capable profile would require its own reviewed tools, allowlists, approval workflow, audit model and rollback behavior. It should not be created by simply removing the existing restrictions.

## 1.6 Capability decision table

| Example request | Profile/path | Expected behavior |
| --- | --- | --- |
| “What is NFS?” | General assistant, read-only | Answer directly |
| “Any cricket matches running?” | General assistant, read-only | Use current public web search |
| “What is my CPU usage?” | General assistant, read-only | Report trusted host snapshots and name each host |
| “Explain this UID paragraph” | Course, knowledge-only | Use highlighted passage and lesson context |
| “What does this module say about NFS identity?” | Course, knowledge-only | Retrieve relevant parts of the open module |
| “Restart Docker” | Read-only | Refuse the action and explain the boundary |

> **Review question**
> Why is “read-only intelligence built from trusted snapshots” safer than letting the model run any command that appears harmless?
