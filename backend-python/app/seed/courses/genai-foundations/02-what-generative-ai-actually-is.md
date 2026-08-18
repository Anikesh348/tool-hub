> **Learning goal**
> Get a precise, non-hand-wavy definition of "generative AI" and see how it differs from the discriminative AI that came before it.

## 2.1 Discriminative vs. generative: the core distinction

Every model in Lesson 1 — spam filters, credit scoring, image classifiers — was **discriminative**: given an input, it picks a label from a small, fixed set of possibilities. "Spam or not spam." "Cat, dog, or bird." The output space is closed and small.

A **generative model** instead learns the underlying *distribution* of the data well enough to produce brand-new examples that plausibly belong to it. Trained on millions of faces, a generative image model doesn't classify a face — it can produce a face that never existed. Trained on the world's text, a generative language model doesn't classify a sentence — it can produce the *next* sentence, and the one after that, indefinitely.

| | Discriminative | Generative |
| --- | --- | --- |
| Question it answers | "Which category does this belong to?" | "What plausibly comes next / what would an example of this look like?" |
| Output space | Small, fixed (labels) | Effectively unbounded (any sequence of tokens) |
| Example (pre-2017) | Spam filter, credit scorer | Early Markov-chain text generators, GANs for images |
| Example (modern) | — (still used for moderation, fraud detection, ranking) | GPT-4, Claude, Gemini, Stable Diffusion, Midjourney |

## 2.2 It's older than ChatGPT — what's new is the quality

Generative models are not a 2022 invention. Markov chains could generate silly-but-grammatical sentences in the 1990s. Generative Adversarial Networks (GANs, 2014) could generate photorealistic-ish faces years before ChatGPT existed. What changed in 2017–2022 wasn't the *concept* of generation — it was the **transformer architecture** (Lesson 4) plus **massive scale**, which pushed text generation from "grammatically plausible but incoherent" to "coherent, factually-grounded-most-of-the-time, and able to follow instructions."

## 2.3 The one idea that unlocked everything: next-token prediction

Modern large language models (LLMs) are trained on a deceptively simple task: given a sequence of text, predict the single next unit of text (a **token** — roughly a word or word-fragment; see Lesson 3). That's it. There is no separate "reasoning module" and no hand-coded grammar rules — every capability the model has (writing code, translating, summarizing, holding a conversation) emerges from getting extremely good at this one prediction task, at a scale of hundreds of billions of examples.

This matters practically: an LLM is fundamentally a **very sophisticated autocomplete engine**. Everything else — chat behavior, following instructions, refusing unsafe requests — is a *layer added on top* of that base capability (Lessons 5 and 6 cover exactly how). Keeping "it's next-token prediction underneath" in mind explains a lot of LLM behavior that otherwise looks mysterious, including why models sometimes state confident-sounding falsehoods (Lesson 7's hallucination section) — a next-token predictor has no built-in notion of "I don't actually know this," only "what token is statistically likely to come next."

## 2.4 Generative AI is multi-modal, not just text

"Generative AI" is broader than chatbots. The same underlying idea — learn a data distribution well enough to sample new, plausible examples from it — applies across modalities:

- **Text**: GPT-4, Claude, Gemini, Llama
- **Images**: Midjourney, DALL·E, Stable Diffusion (these mostly use a different mechanism, *diffusion*, not next-token prediction — trained to reverse a process of adding noise to an image, step by step, until a clean image emerges from pure noise)
- **Audio/speech**: ElevenLabs, OpenAI's voice models, music generators like Suno
- **Video**: Sora, Runway
- **Code**: Codex, Claude Code, GitHub Copilot (text generation specialized on code — Course 2 covers how these become full coding *agents*, not just autocomplete)

This course focuses on text/language models, since they're also the foundation of the agentic systems in Course 2, but the underlying "generate rather than classify" idea is the same across all of them.

## 2.5 A concrete mental model

Think of a large language model as a function with one job:

```text
next_token = model(all_text_so_far)
```

Generating a whole response is just calling that function over and over, feeding each new token back in as part of the input for the next call, until the model produces a special "stop" token. Nothing about this loop requires the model to "understand" anything in a human sense — but at the scale modern models operate at (billions of parameters, trained on trillions of tokens), the statistically-best-next-token turns out to encode a remarkable amount of real-world structure, reasoning, and knowledge. Lesson 3 explains what a "token" and a "parameter" concretely are, and Lesson 4 explains the transformer mechanism that makes this loop good enough to be useful.

> **Review question**
> A spam filter and ChatGPT are both "trained on data," but only one is called generative AI. In your own words, what specifically makes the distinction — is it the training process, the output space, or something else?
