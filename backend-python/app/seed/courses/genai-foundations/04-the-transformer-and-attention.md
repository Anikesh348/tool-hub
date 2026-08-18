> **Learning goal**
> Understand self-attention well enough to explain, in plain language, why the transformer architecture replaced RNNs and made today's LLMs possible.

## 4.1 The 2017 paper that changed everything

In June 2017, Google researchers published a paper literally titled *"Attention Is All You Need."* It proposed dropping the sequential, one-word-at-a-time processing of RNNs entirely, in favor of a mechanism called **self-attention** that lets a model look at an entire sequence of tokens simultaneously. This architecture is the **transformer**, and essentially every major LLM since 2018 — GPT, Claude, Gemini, Llama — is a variant of it. The "T" in GPT literally stands for Transformer.

## 4.2 The problem self-attention solves

Recall from Lesson 3.4: the meaning of a word depends on its context, and pre-transformer RNNs built that context by passing information one token at a time, in strict order — token 50's understanding of token 3 had to survive 47 sequential "hops," fading along the way, and every hop had to happen one after another, which made training slow and hard to parallelize on GPUs.

**Self-attention replaces that relay race with a direct lookup.** Every token computes a relevance score against *every other token in the sequence, directly, in one step* — token 50 can look straight at token 3, with no information loss from intermediate hops, and this happens for all token pairs in parallel rather than sequentially.

## 4.3 How attention actually works, mechanically

For each token, the model computes three vectors from its embedding, using three separate learned weight matrices:

- **Query (Q)** — "what am I looking for?"
- **Key (K)** — "what do I contain / offer?"
- **Value (V)** — "what information do I actually pass along if selected?"

For every pair of tokens, the model compares one token's Query against another token's Key (a dot product) to get a relevance score. Those scores are turned into a smooth 0–1 weighting (via a `softmax` function) across every token in the sequence, and each token's output becomes a *weighted blend of every Value in the sequence*, weighted by how relevant each one is.

```text
For each token:
  score against every other token = Query · Key
  weights = softmax(scores)                # they sum to 1
  output  = weighted sum of every token's Value, using those weights
```

Concretely: in the sentence "The trophy didn't fit in the suitcase because **it** was too big," resolving what "it" refers to requires attention to strongly weight "trophy" over "suitcase" (or vice versa, depending on world knowledge) — and self-attention lets the model learn to do exactly that kind of long-range binding, directly, regardless of how many words separate "it" from its referent.

## 4.4 Multi-head attention: several relevance patterns at once

A transformer doesn't run attention once — it runs several **attention heads** in parallel, each with its own learned Q/K/V weight matrices, each free to specialize in a different kind of relationship (one head might learn to track grammatical subject-verb agreement, another might track coreference like the "it" example above, another might track topical similarity). Their outputs are combined before moving to the next layer. This is why you'll see "multi-head attention" as the actual named component in transformer diagrams, not just "attention."

## 4.5 Why this made scale possible, not just quality

The parallelism is the practical unlock, arguably more than the accuracy improvement. Because every token's attention computation is independent of the others (no waiting for token 3 to finish before starting token 4), the entire sequence can be processed simultaneously on a GPU, which is built exactly for this kind of massively parallel math. That parallelism is *why* it became feasible to train models on trillions of tokens — RNNs' strictly sequential nature would have made that computationally impractical regardless of how much hardware you threw at it.

## 4.6 Positional information has to be added back in

One side effect of processing all tokens at once: attention by itself has no inherent sense of *order* — "dog bites man" and "man bites dog" would look identical to raw self-attention, since it's comparing tokens to each other with no notion of sequence position. Transformers fix this by adding a **positional encoding** to each token's embedding before attention runs — a pattern of numbers that encodes "this token is at position 7," so word order is preserved as an input signal rather than assumed structurally.

## 4.7 The rest of a transformer block

Attention is the headline mechanism, but each transformer layer also includes a small feed-forward neural network (applied to each token's output independently, adding more representational capacity) and residual connections plus normalization steps (which mostly exist to keep training stable across dozens of stacked layers — modern LLMs stack anywhere from a few dozen to over a hundred of these blocks). You don't need the training-stability details to reason about LLM behavior day to day, but it's worth knowing "transformer" means this whole repeated block, not attention alone.

> **Review question**
> Why couldn't RNNs be easily parallelized across a sequence, and how does self-attention's Query/Key/Value mechanism sidestep that specific limitation? Try to answer without using the word "attention" itself — describe the actual computation.
