> **Learning goal**
> Understand every stage of a real RAG pipeline — chunking, embedding, retrieval, reranking, and generation — well enough to reason about why a specific RAG system is giving bad answers.

## 4.1 The problem RAG solves

Course 1 (Lesson 7.2) already named the core trade-off: an LLM's knowledge is frozen at training time and can't cheaply include your private or fast-changing documents. **Retrieval-Augmented Generation (RAG)** solves this without retraining anything — at request time, search your own document store for the pieces most relevant to the user's question, and paste those pieces directly into the prompt as context, so the model answers *using text it can actually see*, not just what it memorized during training.

```text
User question
     |
     v
Embed the question -----> Search vector store for similar chunks
     |                              |
     |                              v
     |                    Top-K relevant chunks
     |                              |
     +--------------+---------------+
                     v
        Prompt = system instructions + retrieved chunks + user question
                     |
                     v
                LLM generates the answer, grounded in the retrieved text
```

## 4.2 Stage 1: ingestion and chunking

Documents are first split into **chunks** — typically a few hundred tokens each — because embedding an entire long document as one vector loses too much specificity (Lesson 4.4 explains why), and because only the relevant chunk, not the whole document, needs to be inserted into the prompt later. Chunking strategy matters more than it sounds:

- **Fixed-size chunking** (e.g., every 500 tokens) is simple but can slice a sentence or idea in half at an arbitrary boundary.
- **Overlap** between consecutive chunks (e.g., each chunk repeats the last 50 tokens of the previous one) reduces the chance that a fact gets split exactly across a chunk boundary and becomes unretrievable in full.
- **Semantic/structure-aware chunking** splits along natural boundaries instead — paragraphs, markdown headers, function definitions in code — producing chunks that are more likely to be self-contained, coherent units of meaning.

## 4.3 Stage 2: embedding and indexing

Each chunk is converted into an embedding vector (Course 1, Lesson 3.3) using a dedicated **embedding model** — usually a smaller, cheaper, specialized model, not the same large model that generates the final answer. Every chunk's vector is stored in a **vector database** (Pinecone, Weaviate, Chroma, pgvector, and others) alongside the original chunk text, indexed for fast similarity search — this indexing step is what lets retrieval stay fast even across millions of chunks.

## 4.4 Stage 3: retrieval

When a user asks a question, the question itself gets embedded with the *same* embedding model, and the vector store returns the chunks whose vectors are closest to the question's vector — "closest" measured by a similarity metric such as cosine similarity. This is why RAG is often described as **semantic search**: it matches on meaning, not exact keyword overlap, so a question phrased completely differently from the source document's wording can still retrieve the right chunk, something classic keyword search (e.g., simple full-text `LIKE '%term%'` matching) cannot do reliably.

Real production systems commonly combine this with **hybrid search** — semantic vector similarity plus traditional keyword/BM25 search run in parallel, results merged — because pure semantic search sometimes misses exact identifiers (product SKUs, error codes, proper nouns) that keyword search catches trivially and embeddings can blur.

## 4.5 Stage 4: reranking (the step most basic RAG tutorials skip)

Vector similarity search is fast but approximate — the top-K results by raw similarity score aren't always the K most *useful* for answering the specific question. A **reranker** — a separate, smaller model specialized for scoring query-document relevance more precisely — takes a larger initial candidate set (say, top 50 by vector similarity) and re-scores them more carefully, keeping only the best few (say, top 5) to actually insert into the prompt. This two-stage "fast broad retrieval, then precise narrow reranking" pattern is standard in production RAG because it's much cheaper to rerank 50 candidates carefully than to run that same expensive precision over the entire document store.

## 4.6 Stage 5: generation, grounded and (ideally) cited

The retrieved chunks are inserted into the prompt (typically in the system or a dedicated context section, per Course 1 Lesson 6.2's role structure), and the model is instructed to answer *using that context*, often with an explicit instruction to say so if the answer isn't contained in it — directly targeting the hallucination problem from Course 1, Lesson 7.5. Production systems commonly also ask the model to **cite** which retrieved chunk supported each claim, both to increase user trust and to make wrong answers auditable back to a specific (possibly wrong, possibly poorly-retrieved) source chunk, rather than an opaque model "belief."

## 4.7 What actually goes wrong in real RAG systems

Knowing the pipeline stages makes debugging bad RAG answers tractable instead of mysterious:

| Symptom | Likely stage at fault |
| --- | --- |
| Answer misses a fact that's definitely in the docs | Chunking split it awkwardly, or retrieval's top-K didn't include the right chunk |
| Answer cites the wrong or an irrelevant document | Retrieval or reranking returned low-relevance chunks; embedding model may be a poor fit for the domain (e.g., generic embeddings on highly technical/legal text) |
| Answer is confident but contradicts the docs | Generation-stage grounding instruction is weak, or the model is overriding retrieved context with its own pretrained "knowledge" |
| Exact codes/IDs/names are wrong or missing | Pure semantic search without a keyword/hybrid component (4.4) |
| System is slow | Reranking too many candidates, or chunk sizes too large, bloating the prompt and context-window usage |

## 4.8 RAG vs. long context: not fully replaced by bigger context windows

Course 1, Lesson 7.1 covered rapidly growing context windows (some now over 1M tokens), which raises a fair question: why not just paste the entire document store into every prompt and skip retrieval? In practice, RAG still wins for large or frequently-changing corpora because attention cost scales with context length (making very long prompts slow and expensive per request, Course 1 Lesson 7.1), and because retrieval acts as a relevance *filter* — even a model that could technically fit a million tokens of context still performs better, and more cheaply, when only the actually-relevant handful of chunks is in front of it rather than everything at once.

> **Review question**
> A company's internal RAG chatbot keeps giving answers that are topically related but miss the specific policy number the user asked about, even though that exact policy document is in the knowledge base. Walk through Stages 1–5 and name at least two different stages that could independently cause this exact symptom, and what you'd check first at each.
