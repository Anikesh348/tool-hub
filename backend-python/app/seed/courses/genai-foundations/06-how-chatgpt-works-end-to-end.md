> **Learning goal**
> Trace one message through ChatGPT (or any similar chat product) end to end — from what you type to what streams back — tying together every concept from Lessons 1–5.

## 6.1 A chat is not what the model sees

When you send a message in ChatGPT, the model does not receive just your message. Every request re-sends the **entire conversation so far**, formatted with special role markers, because the underlying model (Lesson 5) has no persistent memory between API calls — each call is stateless. What's actually sent looks conceptually like:

```text
[system]  You are ChatGPT, a helpful assistant. Follow these guidelines...
[user]    What's the capital of France?
[assistant] The capital of France is Paris.
[user]    What's its population?
```

The model predicts tokens to continue *after* that last `[assistant]` marker — meaning the entire illusion of "memory" in a chat is really just re-showing the model the full transcript every single time, up to its context window limit (Lesson 3.5 / 7.2).

## 6.2 The three roles, and why they exist

- **System** — instructions from the application developer (not the end user), setting persona, rules, and constraints. This is where a company injects product-specific behavior (Course 3 covers real examples).
- **User** — what the person typed.
- **Assistant** — the model's own prior replies, fed back in so it has continuity.

Training (Lesson 5.2's SFT step) specifically teaches the model to treat these roles with different authority — notably, to weigh system instructions above user instructions, which is the entire technical basis for a product being able to say "don't let the user override your instructions." This separation is imperfect (Course 2, Lesson 6 covers prompt-injection attacks that try to defeat it) but it's the mechanism, not a metaphor.

## 6.3 Turning a prompt into a reply: the decoding loop

Internally, generating a reply is the loop from Lesson 2.5, repeated:

1. Run the whole conversation-so-far through the transformer.
2. The final layer outputs a probability distribution over the *entire vocabulary* for "what token comes next" — tens of thousands of candidate tokens, each with a probability.
3. **Sample** one token from that distribution (not always just the single highest-probability one — see 6.4).
4. Append it to the conversation, and repeat from step 1, until a stop token is produced or a length limit is hit.

This is also why responses **stream** token by token in the UI — the model is, quite literally, only just producing the next one at the moment it appears on screen.

## 6.4 Temperature and sampling: why the same prompt gives different answers

If step 3 always picked the single most probable token (**greedy decoding**), the same prompt would always produce the exact same reply, and text would often sound repetitive and stilted. Instead, most chat products sample somewhat randomly from the probability distribution, controlled by a **temperature** parameter:

| Temperature | Behavior |
| --- | --- |
| 0 (or near 0) | Nearly greedy — deterministic, focused, sometimes repetitive. Good for factual/code tasks. |
| ~0.7 (typical default) | Balanced randomness — natural-sounding, some variety between runs. |
| High (close to 1+) | Much more random — creative, but more likely to wander or say something incoherent. |

This is also the direct, mechanical explanation for **hallucination** (covered fully in Lesson 7.5): the model is sampling from a probability distribution, not consulting a database of facts, so a low-probability-but-still-plausible-sounding token can get sampled and continue confidently, with nothing structurally forcing it to be true.

## 6.5 Where "ChatGPT" (the product) adds more than "GPT" (the model)

A commercial chat product is the trained model plus a substantial amount of product engineering around it:

- A carefully written **system prompt**, tuned and updated by the company, independent of retraining the model.
- **Safety classifiers** running alongside the core model — separate, often smaller and cheaper models that screen both input and output for disallowed content, independent of whatever RLHF already trained into the core model.
- **Memory features** (ChatGPT's "memory," Claude's project context) — this is *not* the model learning; it's the product storing facts in a database and re-injecting them into the system/context on future requests, same mechanism as 6.1.
- **Tool access** (web search, code execution, image generation) — the base chat loop above only produces text; tool use is a distinct capability layered on top, and it's the foundation of everything in Course 2 on agentic AI.
- **Rate limiting, cost controls, model routing** (e.g., routing a simple question to a cheaper/faster model and a hard one to a larger model) — infrastructure invisible to the end user.

## 6.6 Multi-turn context is a budget, not infinite memory

Every message you and the assistant exchange adds tokens to the conversation that gets re-sent on the *next* turn (6.1). Once a conversation's total token count approaches the model's context window (Lesson 3.5), something has to give — commonly, the oldest messages get silently dropped or summarized by the product layer. This is why very long chat sessions sometimes seem to "forget" something discussed early on: it's not the model failing to reason, it's that the product-layer context management stopped including that message in what gets sent.

> **Review question**
> If a chat model is stateless per-request and "memory" is really just re-sending the transcript, what happens to cost and latency as a conversation gets longer — and can you connect this to why products eventually summarize or truncate old messages instead of sending the full history forever?
