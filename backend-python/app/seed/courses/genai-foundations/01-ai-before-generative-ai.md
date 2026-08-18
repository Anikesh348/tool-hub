> **Learning goal**
> Understand what "AI" meant before generative models existed, so the jump to ChatGPT-style systems reads as an evolution, not magic.

## 1.1 The word "AI" is older than you think

"Artificial intelligence" has meant different things every decade since 1956. Before 2020, if a product said "AI-powered," it almost always meant one of three very different technologies, and the distinction matters because each has a different failure mode.

## 1.2 Symbolic AI and expert systems (1960s–1980s)

The earliest approach was **symbolic AI**: humans hand-wrote rules, and the computer applied them. An early medical diagnosis tool called MYCIN worked like this — a huge tree of `IF patient has symptom X AND lab result Y THEN suspect disease Z` rules, written by doctors and encoded by engineers.

This is why it's called an **expert system**: the "intelligence" was really a human expert's knowledge, frozen into rules. It worked well in narrow domains but two things killed it at scale:

- **The knowledge bottleneck.** Every new fact required a human to write a new rule. Nothing generalized.
- **Brittleness.** A question one word outside the rule set produced nonsense or a blank refusal, not a reasonable guess.

You still see this pattern today in tax software, IVR phone trees ("press 1 for billing"), and old-school chatbots that only match exact keywords — all descendants of symbolic AI.

## 1.3 Classical machine learning (1990s–2012)

The next shift replaced hand-written rules with **statistics learned from data**. Instead of a human writing "if income > X and age < Y, approve the loan," you gave the computer thousands of past loan outcomes and let an algorithm (logistic regression, decision trees, support vector machines, random forests) find the pattern itself.

This was a real leap — the system could now handle cases no human had explicitly anticipated — but it depended on **feature engineering**: a human still had to decide what *inputs* the model should look at (income, credit score, zip code…). Get the features wrong, and no amount of data fixes it. This is why classical ML worked brilliantly for spam filters and credit scoring, but poorly for anything involving raw text, images, or audio, where nobody could hand-design the "right features" for a photo of a cat.

## 1.4 Deep learning removes the feature-engineering step (2012–2017)

**Neural networks** — loosely inspired by how brain neurons connect — had existed since the 1950s but were too slow to train on real data. Two things changed in the early 2010s: GPUs (built for video game graphics, repurposed for matrix math) made large networks trainable in days instead of years, and the internet supplied enormous labeled datasets (millions of tagged images, for instance).

The 2012 ImageNet competition is the usual marker: a deep neural network called AlexNet beat every classical computer-vision method by a huge margin, by learning its own features directly from raw pixels instead of using hand-designed ones. This kicked off the **deep learning era** — convolutional networks (CNNs) for images, recurrent networks (RNNs/LSTMs) for sequences like text and speech.

## 1.5 Why pre-transformer NLP still felt limited

Text is a *sequence* — word order matters — so language modeling used RNNs/LSTMs, which read one word at a time and carried a running "memory" forward. This had two structural problems that generative AI later solved:

- **Long-range forgetting.** By the time an LSTM reached word 200 of a paragraph, information from word 5 had mostly faded from its memory. Coherent long-form generation was very hard.
- **No parallelism.** Because each word depended on the previous one being processed first, training could not be parallelized across a sequence — making it slow to train on huge datasets, which throttled how large (and capable) these models could realistically get.

Word embeddings (word2vec, GloVe, ~2013–2014) were an important interim idea — representing each word as a list of numbers ("vector") such that similar words end up close together in that number-space (`king − man + woman ≈ queen` is the famous example). Vectors like this are the direct ancestor of the embeddings used throughout modern retrieval and RAG (Course 2, Lesson 4).

## 1.6 One model, one narrow job

Across all three eras, a defining trait held: **a model did one job**. A spam classifier could not summarize an email. An image classifier could not describe what it saw in a sentence. Building a new capability meant collecting a new labeled dataset and training a new model from scratch, and the model had no notion of a conversation, an instruction, or "explain your reasoning."

| Era | Approx. years | "Intelligence" came from | Failure mode |
| --- | --- | --- | --- |
| Symbolic AI / expert systems | 1960s–1980s | Hand-written rules | Brittle outside the rule set |
| Classical machine learning | 1990s–2012 | Statistics over hand-picked features | Only as good as the chosen features |
| Deep learning (pre-transformer) | 2012–2017 | Learned features, but sequential/narrow | Forgetful over long text, one task per model |

## 1.7 What generative AI actually changed

Generative AI (the subject of the rest of this course) is not "smarter statistics." It is a combination of one architectural breakthrough — the **transformer**, covered in Lesson 4 — and a change in *training objective*: instead of training a model to output one fixed label (spam/not-spam, cat/dog), train it to predict the *next piece of text*, on almost all the text humanity has published. That single, boring-sounding objective, at large enough scale, turned out to produce something classical ML never did: one model that can translate, summarize, code, and reason about topics it was never explicitly labeled for. Lesson 2 defines exactly what "generative" means and why that matters.

> **Review question**
> A 2015-era customer support chatbot could only answer questions that matched a pre-written script, while a 2023-era one can answer paraphrased or novel questions it was never explicitly programmed for. Which historical limitation from this lesson did the second one overcome, and which architectural idea (name it, even if you don't yet know how it works) gets credit for that?
