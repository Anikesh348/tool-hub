> **Learning goal**
> Build working vocabulary for the modern LLM concepts that show up constantly in product docs and pricing pages, but that Lessons 1–6 didn't have room to cover.

## 7.1 Context windows: why "1M tokens" is a headline feature

The context window (Lesson 3.5) is the maximum number of tokens a model can consider in one request — input plus output combined. Early GPT-3 shipped with a 2,048-token window (a few pages of text); modern frontier models offer 128K to over 1M tokens (hundreds of pages, or entire codebases). This matters enormously for agentic tools like Claude Code (Course 2, Lesson 5), which need to hold large amounts of file content, tool output, and conversation history in view at once. A bigger window doesn't just mean "can read a longer document" — attention (Lesson 4) compares every token against every other token, so compute cost grows roughly quadratically with context length, which is a large part of *why* long-context models are expensive and were hard to build.

## 7.2 Prompting vs. fine-tuning vs. RAG: three ways to specialize a model

A recurring practical question: "the model doesn't know about my specific data/domain — what do I do?" There are three different tools, and picking the wrong one is a common real-world mistake:

| Approach | What it changes | Good for | Bad for |
| --- | --- | --- | --- |
| Prompting (incl. system prompts, few-shot examples) | Nothing in the model — only what's sent per-request | Fast iteration, small amounts of context, behavior tweaks | Large private knowledge bases; costs tokens on every request |
| RAG (retrieval-augmented generation) | Nothing in the model — retrieves relevant documents and inserts them into the prompt at request-time | Large, frequently-updated knowledge bases; grounding answers in specific documents | Teaching new *skills* or styles the model can't already do |
| Fine-tuning | The model's actual weights | Consistent style/format, domain-specific behavior, cheaper inference (no need to resend the same instructions every time) | Injecting frequently-changing facts (requires retraining to update) |

RAG gets a full course-2 lesson (Lesson 4) because it's the dominant pattern for "make the model answer questions about *my* documents" without the cost and staleness problems of fine-tuning.

## 7.3 Quantization: making big models cheaper to run

A model's parameters (Lesson 3.1) are normally stored as 16-bit or 32-bit numbers. **Quantization** compresses them to lower precision — 8-bit, 4-bit, even lower — trading a small amount of accuracy for large reductions in memory use and inference cost. This is why the same "70-billion-parameter" open-weight model can sometimes run on a single high-end consumer GPU (quantized) versus needing a rack of data-center GPUs (full precision) — and it's a big part of how on-device and self-hosted LLM deployments became practical at all.

## 7.4 Mixture of Experts (MoE): bigger models without proportionally bigger cost

A **dense** model uses every single parameter for every single token it processes. A **Mixture of Experts** model instead splits its parameters into many "expert" sub-networks and, per token, only routes computation through a small subset of them (chosen by a learned "router" component) — so the model can have a very large *total* parameter count (more learned knowledge) while only paying the compute cost of a much smaller *active* parameter count per token. Several modern frontier and open-weight models use this pattern; it's why parameter counts alone (Lesson 3.5) are an increasingly incomplete way to compare model cost or speed.

## 7.5 Hallucination: not a bug in the traditional sense

Building directly on Lesson 6.4: hallucination is the term for a model stating something false with the same fluent confidence as something true. It is a *structural* consequence of the architecture, not a rare glitch to be patched out — a next-token predictor (Lesson 2.3) has no built-in mechanism to distinguish "this token continues a fact I actually learned" from "this token is simply statistically plausible given everything so far." Mitigations in real products layer on top rather than eliminate it at the source: RAG (grounding answers in retrieved real documents, 7.2), citations (making the model point to a specific source it can be checked against), lower temperature for factual tasks (6.4), and explicit "I don't know" training during RLHF (Lesson 5.3) so refusal-to-guess is itself a rewarded behavior. Course 3 covers how production systems add further guardrails around this.

## 7.6 Multimodality: one model, several input/output types

Early LLMs were text-in, text-out. Modern frontier models are commonly **multimodal**: the same model can accept images (and sometimes audio/video) as input, and some can generate images too. Mechanically, this usually works by converting the non-text input into embeddings (Lesson 3.3) that live in a *compatible* vector space to text-token embeddings, so the same transformer stack (Lesson 4) can attend across text and image information jointly, rather than needing a completely separate model per modality.

## 7.7 Reasoning models and "thinking" tokens

Newer models (OpenAI's o-series, Claude's extended thinking, DeepSeek-R1, and others) are trained to produce an extended internal chain of intermediate reasoning tokens *before* committing to a final answer — effectively spending more compute per question, at request-time, on harder problems. This is trained in specifically (via reinforcement learning rewarding correct final answers reached through valid reasoning chains) rather than being a new architecture — it's the same transformer from Lesson 4, used differently: allowed to "think out loud" in tokens the model itself generates and reads back, before the user-facing answer.

## 7.8 A working glossary

| Term | One-line meaning |
| --- | --- |
| Token | A chunk of text (word or word-piece) — the model's basic unit (3.2) |
| Embedding | A learned numeric vector representing a token's/document's meaning (3.3) |
| Context window | Max tokens a model can consider in one request (3.5, 7.1) |
| Parameters | The model's learned weights; its "size" (3.1, 3.5) |
| Fine-tuning | Further training an existing model's weights on new data (5.6, 7.2) |
| RAG | Retrieving real documents and inserting them into the prompt at request-time (7.2, Course 2 Lesson 4) |
| Temperature | Controls how random/deterministic token sampling is (6.4) |
| Hallucination | Fluent, confident, false output — structural, not incidental (7.5) |
| Quantization | Lower-precision weights for cheaper inference (7.3) |
| System prompt | Developer-set instructions sent with every request (6.2) |

This closes out the foundations course. Course 2 builds directly on top of everything here — RAG (7.2) gets its own deep-dive lesson, and the chat loop from Lesson 6 is exactly what gets extended with *tool calls* to become an agent.

> **Review question**
> A team wants their internal support bot to always answer using their company's latest internal wiki, which changes daily. Using the table in 7.2, which approach should they pick, and specifically why would fine-tuning be the wrong tool here even though it "bakes in" knowledge more permanently?
