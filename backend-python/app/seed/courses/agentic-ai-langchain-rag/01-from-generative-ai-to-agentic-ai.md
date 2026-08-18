> **Learning goal**
> Understand precisely what changed to turn a text-generating chat model into an "agent" — and why tool calling, not a new architecture, is the key.

## 1.1 A plain-text model cannot *do* anything

Everything in Course 1 describes a model that takes text in and produces text out. However good the text is, a base chat model cannot check today's weather, query a database, run code, or click a button — it can only generate a plausible-sounding *description* of doing those things. That gap between "can describe an action" and "can actually take an action" is exactly what agentic AI closes.

## 1.2 Tool calling: the mechanism, not the metaphor

Modern LLMs are trained (as part of the SFT/RLHF pipeline from Course 1, Lesson 5) to recognize when a request needs an external capability, and — instead of guessing an answer — output a structured, machine-parseable request to call a specific function, with specific arguments:

```json
{
  "tool": "get_weather",
  "arguments": { "city": "Bengaluru" }
}
```

Critically, **the model does not execute this itself.** It only ever outputs text — in this case, text shaped like a function call. The surrounding application (not the model) is responsible for recognizing that shape, actually running the real `get_weather` function, and feeding the result back into the conversation as a new message, so the model can read it and continue. This is the entire mechanism behind every "agent," "tool use," and "function calling" feature you'll encounter — there is no separate action-taking module inside the model; it is the same next-token-prediction loop from Course 1, Lesson 6, just with a new kind of message type flowing through it.

## 1.3 The agent loop

Put together, an agent is a repeating loop, not a single request/response:

```text
1. Model reads conversation + available tool definitions
2. Model either answers directly, OR emits a tool call
3. If a tool call: application executes the real function, appends the result as a new message
4. Go back to step 1 — model now sees the tool's result and decides what to do next
5. Repeat until the model produces a final answer with no further tool calls
```

This loop is often called **ReAct** (Reason + Act), from a 2022 research paper that formalized "let the model alternate between reasoning in text and taking an action, observing the result, and reasoning again" as a prompting pattern. It's less a specific product and more the conceptual template nearly every agent framework (Lessons 2–3) and coding agent (Lesson 5) still follows today.

## 1.4 Why this counts as a genuinely new capability class

A single tool call is a small thing, but the loop compounds: a model can call a search tool, read the result, decide it needs a second, more specific search, read *that* result, then write code, run it, see an error, and fix it — a multi-step, self-correcting process with no human in the loop between steps. That's qualitatively different from Course 1's chat model, which produces one response and stops. This is precisely what makes tools like Claude Code able to work through a multi-file bug fix autonomously rather than just describing how you'd fix it.

## 1.5 Non-determinism is now a systems problem, not just a quality problem

In a plain chat product, an oddly-phrased or wrong answer is a bad user experience. In an agentic system, the model's choices *drive real actions* — which file to edit, which API to call, whether to delete something. This is why agentic systems need infrastructure that chat products don't: permission boundaries on what tools can even be called (Lesson 5, and the ToolHub gateway/executor design in Course 3), guardrails that check actions before or after they run (Lesson 6), and often a human-approval step for anything destructive. The jump from "generates text" to "takes actions" is exactly the jump from a UX risk to an operational-safety risk.

## 1.6 A spectrum, not a binary

"Agentic" isn't one fixed thing — it's useful to think of it as a spectrum of how much autonomy the loop is given:

| Level | Example | Human involvement |
| --- | --- | --- |
| Single tool call | "What's the weather in Delhi?" → one search, one answer | Approves nothing; sees only the final answer |
| Bounded multi-step task | An email assistant that drafts a reply using calendar + contact lookups | Reviews the draft before it sends |
| Autonomous coding agent | Claude Code fixing a bug across several files, running tests, iterating | Reviews the diff/PR, may not watch each step |
| Fully autonomous operator | A system that can restart services, deploy code, without per-action approval | Sets policy up front; doesn't approve individual actions |

Course 3 covers where real companies land on this spectrum for customer-facing products, and why almost none of them ship at the fully-autonomous end.

> **Review question**
> Step back to Course 1, Lesson 6.1: a plain chat model is stateless and only ever produces text. Precisely which part of the agent loop in 1.3 is what actually lets a model's output cause something to happen in the real world — and why is it accurate to say the model itself still never "does" anything, even in a fully agentic system?
