> **Learning goal**
> Understand the stages a raw transformer goes through to become a usable model, and why "pretraining" alone is not enough to produce something like ChatGPT.

## 5.1 Stage one: pretraining, the expensive part

**Pretraining** is exactly the process described in Lesson 2.3: feed the model enormous amounts of text (web pages, books, code, forums — commonly trillions of tokens) and repeatedly train it to predict the next token, adjusting its billions of parameters (Lesson 3.1) a little after every batch of examples. This stage is where almost all of a model's raw factual knowledge, grammar, reasoning patterns, and world model come from, and it's astronomically expensive — training a frontier model can cost tens to hundreds of millions of dollars in compute, run across thousands of GPUs for weeks or months.

A pretrained model, on its own, is called a **base model**. It is genuinely just a next-token predictor with no notion of "conversation" — ask it a question and it's just as likely to continue with *more questions in the same style* (because that pattern appeared constantly in its training data, e.g., FAQ pages) as it is to answer. This is why base models are not what you interact with when you use ChatGPT or Claude.

## 5.2 Stage two: supervised fine-tuning (SFT)

To turn a base model into something that behaves like an assistant, labelers write (or curate) thousands of example conversations: a realistic user instruction paired with a high-quality, ideal response. The model is then further trained — much more cheaply and briefly than pretraining — to imitate this style directly. This step is called **supervised fine-tuning (SFT)**, and it's what teaches the model the *behavioral shape* of being helpful: answering the actual question asked, in a direct and appropriately-formatted way, rather than continuing the text however statistically-likely text tends to continue.

## 5.3 Stage three: reinforcement learning from human feedback (RLHF)

SFT alone tends to produce a model that's *stylistically* assistant-like but still not well calibrated on what humans actually prefer — which of two correct-sounding answers is more helpful, more honest, or safer. **RLHF** closes that gap in two steps:

1. **Train a reward model.** Show human raters several candidate responses to the same prompt and have them rank which is better. Train a separate, smaller model to predict that human preference ranking — this is the **reward model**.
2. **Optimize the LLM against that reward model.** Using a reinforcement-learning algorithm (commonly PPO, or newer, cheaper variants like DPO), nudge the LLM's outputs to score higher according to the reward model, while a penalty term keeps it from drifting too far from its original SFT behavior (to avoid it gaming the reward model with degenerate outputs).

This is the step most responsible for a model feeling "aligned" — helpful, willing to admit uncertainty, and inclined to refuse clearly harmful requests — because it's directly optimized against *human judgment of response quality*, not just imitation of examples.

```text
Pretraining (trillions of tokens, next-token prediction)
        -> Base model (raw completion engine, no "assistant" behavior)
Supervised fine-tuning (thousands of curated Q&A examples)
        -> SFT model (behaves like an assistant, imperfectly calibrated)
RLHF (reward model + reinforcement learning against human preference)
        -> Aligned model (what you actually talk to)
```

## 5.4 Why this pipeline explains real model behavior

Several things that look like "the model is being weird" make more sense once you know this pipeline:

- **A model refusing a benign-but-oddly-phrased request** — RLHF trained it to pattern-match against *categories* of risky phrasing, and that pattern-matching is imperfect in both directions (over- and under-refusing).
- **A model being sycophantic** (agreeing with you even when you're wrong) — a known, documented side effect of RLHF: human raters tend to rate agreeable-sounding responses higher on average, and the reward model absorbs that bias.
- **Two different models from the same company having different "personalities"** despite similar base pretraining — SFT and RLHF are where a lab injects most of its intentional style and values, on top of a base model that's comparatively generic.

## 5.5 Instruction tuning and system prompts are not the same thing

It's worth separating two things that both shape "how the model behaves" but happen at very different times:

- **SFT/RLHF (Lessons 5.2–5.3)** happen once, during training, and are baked into the model's weights permanently until the next training run.
- **The system prompt** (covered in Lesson 6) is supplied fresh with *every request*, at use-time, and steers behavior without changing a single weight. A company deploying an LLM in production almost always layers a system prompt on top of an already-RLHF'd model — Course 3 covers exactly this pattern in real company deployments.

## 5.6 A note on cost and who can do this

Pretraining a frontier model from scratch is only realistic for a handful of well-funded labs (OpenAI, Anthropic, Google, Meta, and a few others) because of the sheer compute cost. SFT and lightweight fine-tuning, by contrast, are within reach of individual companies and even hobbyists — you can take an already-pretrained open-weight model (like Llama) and fine-tune it on a much smaller, domain-specific dataset for a fraction of the cost. This distinction — train-from-scratch vs. fine-tune-an-existing-model — is why "open-weight" models unlocked a wave of specialized, cheaper AI products without every company needing OpenAI-scale budgets.

> **Review question**
> A base model (right after pretraining, before SFT or RLHF) is given the prompt "What is the capital of France?" Based on what you now know about the pretraining objective, what's a plausible *bad* completion it might produce — and specifically why would SFT be needed to fix it, rather than just "more pretraining data"?
