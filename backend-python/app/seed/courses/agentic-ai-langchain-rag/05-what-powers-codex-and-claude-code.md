> **Learning goal**
> Understand, mechanically, what turns an LLM into a coding agent like Codex or Claude Code — the tool set, the permission model, and the context-management tricks that let it work on a real, large codebase.

## 5.1 Same loop, a much richer tool set

Claude Code and Codex are, at the core, exactly the agent loop from Lesson 1.3 — read state, decide to answer or call a tool, execute, feed the result back, repeat — pointed at a specialized toolbelt for working with a codebase instead of general web tools. A representative tool set looks like:

| Tool category | Examples | Purpose |
| --- | --- | --- |
| Read | Read a file, list a directory, search (grep/glob) | Build understanding of the codebase before acting |
| Write | Edit a file (targeted diff), write a new file | Make the actual code change |
| Execute | Run a shell command, run tests, run a build | Verify changes, gather ground truth (errors, test failures) instead of guessing |
| Meta / orchestration | Spawn a sub-agent, manage a task list, fetch a URL | Break large tasks into steps, delegate scoped work, pull external context |

The single most important design idea is: **the model is repeatedly given ground truth from the real system** (an actual test failure, an actual compiler error) rather than reasoning purely from what it wrote — this closes-the-loop pattern is what allows genuinely multi-step, self-correcting work, rather than one-shot code generation that might not even run.

## 5.2 Why "just an LLM with a shell tool" would be dangerous

Course 2, Lesson 1.5 raised the general risk of an agent's output driving real actions. For a coding agent specifically, an unrestricted shell tool is a direct path to data loss or a compromised machine — a wrong `rm -rf`, a leaked credential, a destructive `git push --force`. Every serious coding agent therefore wraps raw execution in a **permission system**, not just a system-prompt instruction asking the model to be careful (a system prompt is not a security boundary — Lesson 6 covers why). Concretely, this typically includes:

- **Tiered approval** — read-only actions (reading a file) run freely; higher-risk actions (editing a file, running a shell command, especially anything matching destructive patterns) require either a pre-approved allowlist or an explicit human confirmation before executing.
- **Sandboxing** — running the agent's shell access inside a container or restricted environment, so even a genuinely bad command has a limited blast radius, rather than full access to the host machine.
- **Explicit non-negotiable guardrails** — some actions (force-pushing to a protected branch, disabling security checks, deleting broad swaths of files) are built to always require explicit human confirmation, regardless of what the model "decides," precisely because model judgment alone is not treated as a sufficient safety boundary.

This is the same underlying principle ToolHub's own AI integration uses architecturally (Course 3, Lesson 5) — capability profiles that structurally deny an entire category of action (like `read-only` denying shell access outright) are a stronger guarantee than trusting the model to decline.

## 5.3 Context management: working with codebases bigger than the context window

Even a 1M-token context window (Course 1, Lesson 7.1) can't hold every large repository at once, and pasting in irrelevant files wastes budget and hurts the model's focus. Coding agents manage this actively rather than passively:

- **Targeted reads over full dumps** — searching/grepping for relevant symbols and reading only the specific files or line ranges that matter, mirroring how a human engineer would navigate an unfamiliar codebase rather than reading it start to finish.
- **Sub-agents for isolated exploration** — spinning up a separate agent instance to research a narrow question (e.g., "find every place this function is called") and return only a *summary* of the finding, keeping the large volume of intermediate search results out of the main agent's context budget entirely.
- **Compaction/summarization** — when a long working session's context approaches the window limit, older tool outputs and conversation turns get summarized down to their essential facts (directly analogous to Course 1, Lesson 6.6's chat-truncation behavior, but done deliberately and more carefully for a task where losing a critical fact is costlier).
- **Task/plan tracking as external state** — maintaining an explicit, structured task list *outside* the free-text conversation, so a long multi-step job's progress survives context compaction even if the earlier conversation detail doesn't.

## 5.4 Reading real signals, not just generating plausible code

The property that most separates a coding agent from "autocomplete with extra steps" is **verification loops**: after making a change, the agent runs the actual test suite, the actual type checker, the actual build — and reads the *real* output, including failures, to decide its next move. This connects directly back to Course 1, Lesson 6.4's point about temperature and sampling: a model's first guess at a fix is a sample from a probability distribution, not a guarantee, and running real verification is what catches a wrong sample before it reaches the user, rather than presenting unverified guesses as finished work.

## 5.5 What "full agentic control" concretely means

When people say a tool provides "full agentic control," they usually mean some combination of:

- **Multi-step autonomy** — the agent can complete a task spanning many files and many tool calls without a human approving each individual step (as opposed to a simple one-shot code-completion suggestion).
- **Environment access** — real shell/file/network access (heavily permissioned, per 5.2), not just text generation.
- **Self-direction over the plan** — the agent decides *what* to do next based on what it observes (5.4), rather than following a fixed, human-authored script.
- **Extensibility** — the ability to add new tools (including connecting to entirely external systems — this is exactly what the Model Context Protocol, covered in Lesson 6, standardizes) without redesigning the core loop.

None of this requires a different model architecture from Course 1 — it's the same transformer-based next-token predictor, wrapped in an agent loop (Lesson 1.3), given a rich and carefully-permissioned tool set, and given real verification signals to correct itself against. The "intelligence" is the same; the *system* around it is what changed.

> **Review question**
> Two designs are proposed for a coding agent's shell access: (A) a system-prompt instruction telling the model "never run destructive commands," and (B) a permission layer that structurally blocks a fixed list of destructive command patterns regardless of what the model outputs. Using the reasoning from 5.2, explain concretely why (B) is a stronger guarantee than (A), and describe one kind of failure (A) wouldn't catch that (B) would.
