> **Learning goal**
> Understand the wrapper above the Codex CLI: its private API, fixed invocation, permission enforcement and result parsing.

## 5.1 Why the wrapper exists

`codex exec` is a CLI designed for an interactive or agentic environment. Applications need a stable request/response service with authentication, timeouts, concurrency limits and safe error messages. The executor wrapper supplies that service without exposing a general shell.

It runs on `hp-codex` because that VM is the dedicated low-blast-radius management guest. It does not run on `hp-purva`, the Proxmox hypervisor.

## 5.2 Private executor API

The executor exposes:

```text
GET  /healthz
GET  /readyz          scope executor:read
POST /v1/execute      scope executor:invoke
```

Only the matching gateway identity is registered, normally restricted to the gateway’s Tailscale source address. The executor repeats HMAC, timestamp, scope and nonce validation even though the gateway already authenticated ToolHub. This is a separate trust boundary.

The execute payload contains only:

```text
input
providerConversationId
capabilityProfile
```

Thread IDs are length-limited and restricted to alphanumeric, dash and underscore characters before appearing in a command.

## 5.3 Starting a new Codex thread

For a new request the wrapper constructs a fixed argv resembling:

```text
/usr/local/bin/codex exec
  --json
  --skip-git-repo-check
  --ignore-user-config
  --strict-config
  -C /var/lib/codex-executor/workspace
  [fixed -c overrides]
  -
```

The prompt is sent over stdin. No user-controlled string is interpreted by a shell. `subprocess.Popen` receives an argument list directly.

## 5.4 Continuing a Codex thread

When ToolHub supplies an opaque provider conversation ID, the command becomes conceptually:

```text
codex exec resume --json --all ... THREAD_ID -
```

Codex restores its own conversation state. ToolHub still stores the readable messages, while the provider ID enables model continuity.

## 5.5 Fixed common restrictions

Every profile applies fixed overrides:

- `approval_policy="never"`;
- multi-agent, apps, plugins, remote plugins, hooks, memories and goals disabled;
- browser/computer/in-app browser disabled;
- login shells disabled;
- updater, analytics and feedback disabled;
- user configuration ignored and strict configuration required.

The child environment is rebuilt from a small allowlist: a fixed home/Codex home, user identity, system `PATH`, UTF-8 locale, dumb terminal and no color. The parent service environment is not blindly inherited.

## 5.6 Knowledge-only configuration

Knowledge-only disables shell tooling, network and web search. Its developer instructions require answers from model knowledge and supplied context and prohibit commands, files, tools, browsing and permissions requests.

This is the course profile. Even if lesson text contains a malicious instruction such as “run this command,” there is no shell tool for the model to call.

## 5.7 Read-only configuration

Read-only still disables shell tooling and general network permission. It enables the controlled Codex web-search capability and receives trusted snapshots as prompt text. Its developer policy forbids creating, editing, deleting, installing, restarting, signalling or otherwise changing systems.

Before launching Codex, the runner adds the `hp-codex` runtime snapshot. Because the gateway already inserted `ubuntu-purva`, the final prompt can contain both hosts.

## 5.8 Process lifecycle and timeout

The process starts in a new session, making it the leader of a process group. The wrapper waits up to 300 seconds. On timeout it sends `SIGTERM` to the entire group, waits five seconds, then uses `SIGKILL` if necessary. This prevents a child process from surviving after the HTTP request has failed.

Only one run can execute. Oversized prompts fail before process creation.

## 5.9 Structured-event parsing

Codex writes JSON events. The parser scans each line and extracts:

- the thread ID from `thread.started`;
- agent text from completed agent-message items;
- the final response from `turn.completed` when present.

Both a thread ID and non-empty final answer are required. Missing fields become stable executor errors. Stderr is inspected only to distinguish provider authentication failures from general failures; raw stderr is not sent to applications.

## 5.10 Systemd sandbox

The executor runs as `anikesh348` with:

- `NoNewPrivileges`;
- strict system protection and read-only home protection;
- empty Linux capability bounding set;
- restricted address families and native syscall architecture;
- private temporary directory;
- task and memory limits;
- write access only to executor state and the Codex home required for authenticated runtime/thread state.

Systemd hardening and Codex permission profiles solve different problems. Systemd limits the service process at the operating-system level; Codex configuration limits the model’s exposed capabilities.

> **Wrapper checkpoint**
> Why are direct argv construction, ignored user config, a sanitized environment and process-group termination all needed even when the model is instructed to be read-only?
