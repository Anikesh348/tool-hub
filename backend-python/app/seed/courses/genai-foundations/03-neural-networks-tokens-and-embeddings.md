> **Learning goal**
> Learn the three building blocks every later lesson assumes: what a neural network actually computes, what a token is, and what an embedding is.

## 3.1 A neural network is a stack of simple math, not magic

Strip away the biological metaphor and a neural network is: a sequence of layers, where each layer takes a list of numbers in, multiplies them by a big grid of adjustable numbers (**weights**), adds some more adjustable numbers (**biases**), and passes the result through a simple non-linear function before handing it to the next layer.

```text
input numbers -> [layer 1: multiply + add + squash] -> [layer 2: same] -> ... -> output numbers
```

The "squash" step (called an **activation function**) is important: without it, stacking layers would mathematically collapse into one big multiplication, unable to represent anything but straight lines. With it, a large enough stack can approximate extremely complex functions — which is the entire theoretical justification for why deep learning works at all.

**Training** means: show the network an example, compare its output to the correct answer, and nudge every weight slightly in the direction that would have made the output more correct (an algorithm called **backpropagation** combined with **gradient descent**). Repeat billions of times. A model's **parameters** are just all those weights and biases, counted up — when you hear "a 70-billion-parameter model," that's the number of individually-adjustable numbers the training process tuned.

## 3.2 Text has to become numbers: tokenization

Neural networks only operate on numbers, so the first step for any language model is converting text into a sequence of numbers. This happens via **tokenization** — splitting text into chunks (tokens) from a fixed vocabulary, then replacing each chunk with its ID number in that vocabulary.

Tokens are usually *not* whole words. Modern tokenizers (e.g., byte-pair encoding, used by GPT-style models) build a vocabulary of the most common word-pieces in a huge training corpus, so common short words become one token ("the", "is") while rarer or longer words split into pieces:

```text
"tokenization" -> ["token", "ization"]     (2 tokens)
"ToolHub"      -> ["Tool", "Hub"]          (2 tokens)
"unbelievable" -> ["un", "believ", "able"] (3 tokens)
```

This is why LLM pricing and context limits are quoted in **tokens**, not words or characters — roughly 1 token ≈ 0.75 English words, but this ratio gets worse for non-English text, code, and rare vocabulary, which tokenize into more pieces per word.

## 3.3 Embeddings: turning tokens into meaning-bearing vectors

A raw token ID (e.g., "the" is token #464) carries no meaning by itself — ID 464 isn't mathematically "closer" to any other word. The model's first real layer is an **embedding layer**: a lookup table that maps each token ID to a vector — a list of hundreds or thousands of numbers — and, critically, that vector *is* learned during training, so that tokens used in similar contexts end up with similar vectors.

This produces the property from Lesson 1.5's word2vec mention, now at much higher fidelity: vector arithmetic starts to reflect meaning. Directions in this high-dimensional space encode relationships — plural-vs-singular, capital-city-of, past-tense-of — purely as a side effect of predicting text well.

Embeddings are useful for more than just the inside of a language model. Because semantically similar text ends up with similar vectors, you can embed a whole document, store the vector, and later find "meaningfully similar" documents by comparing vectors — with no keyword matching at all. This is the exact mechanism RAG pipelines are built on (Course 2, Lesson 4): a search engine over *meaning*, not just text.

## 3.4 Context: a sequence of vectors, not one vector

A sentence isn't one embedding — it's a *sequence* of them, one per token. A model needs to combine information across that whole sequence, because meaning depends on context: "bank" means something different next to "river" than next to "interest rate." Pre-transformer models (the RNNs from Lesson 1.5) combined sequence information one token at a time, in order, which is exactly what made them slow to train and forgetful over long text. Lesson 4 covers the mechanism — **self-attention** — that transformers use instead, letting every token look directly at every other token in the sequence at once.

## 3.5 Parameters vs. training data vs. context — three sizes that get confused

These three numbers are frequently conflated in casual conversation about LLMs, but they measure completely different things:

| Term | What it measures | Typical unit |
| --- | --- | --- |
| Parameters | How large/expressive the model itself is (weights learned once, during training) | Billions (e.g., "70B model") |
| Training data | How much text the model learned from, before you ever use it | Trillions of tokens |
| Context window | How much text you can feed in for a *single* request, at use-time | Thousands to millions of tokens |

A bigger context window doesn't make a model "know" more — it makes the model able to *consider more text at once* for the current answer (Lesson 7 covers this, and why it's central to how tools like Claude Code work).

> **Review question**
> "ToolHub" tokenizes as two tokens, not one. Why does that happen, and what would you expect to happen to a word that's very common in English versus a rare proper noun or a piece of code — which one uses more tokens per character, and why does that matter for cost and context-window budgeting?
