> **Learning goal**
> Understand what LangChain actually provides (and doesn't), so you can read or write LangChain code with a clear mental model instead of treating it as a black box.

## 2.1 What problem LangChain solves

Before frameworks like LangChain existed (it launched in late 2022), building anything beyond a single API call to an LLM meant hand-writing a lot of repetitive plumbing: formatting prompts, parsing model output, calling different providers (OpenAI vs. Anthropic vs. others) through different SDKs, wiring up tool calls (Lesson 1.2), managing conversation memory, and connecting to vector databases for RAG (Lesson 4). LangChain is a library that standardizes all of this repetitive plumbing behind common interfaces, so switching a component (say, a different LLM provider, or a different vector database) doesn't mean rewriting your application logic.

It is **not** a different kind of AI, and it does not make a model smarter — it's application-layer glue code, comparable to what a web framework like Express or Django is to a web application: useful structure around the actual logic, not the logic itself.

## 2.2 The core abstraction: chains

The library's namesake concept, a **chain**, is a sequence of steps where each step's output feeds the next step's input — for example: format a prompt → call the LLM → parse the response into structured data → pass it to the next step. Modern LangChain expresses this with a composition syntax (LCEL, LangChain Expression Language) using the `|` (pipe) operator, deliberately evocative of Unix pipes:

```python
chain = prompt_template | model | output_parser
result = chain.invoke({"topic": "generative AI"})
```

Each of `prompt_template`, `model`, and `output_parser` is a swappable, independently-testable component implementing a common interface (`Runnable`), which is the actual architectural payoff: you can swap `model` from one provider to another without touching the rest of the chain.

## 2.3 Prompt templates

Rather than string-concatenating user input into a prompt by hand (error-prone, and easy to leave an injection-style gap — Lesson 6 covers this), LangChain provides `PromptTemplate`/`ChatPromptTemplate` objects: reusable templates with named placeholders, validated and filled in consistently every call. This sounds trivial, but it's exactly the abstraction that keeps large applications with dozens of different prompts maintainable, versionable, and testable.

## 2.4 Tools and agents

LangChain provides a standard `Tool` interface — a name, a description (which becomes part of what the model reads to decide *when* to call it), and the actual Python function to execute — plus prebuilt "agent" constructs that implement the loop from Lesson 1.3: read available tools, let the model choose one, execute it, feed the result back, repeat. This is the part of LangChain most directly relevant to agentic AI — it turns "the ReAct loop" from a pattern you'd hand-write into a few lines of configuration.

## 2.5 Memory

Course 1, Lesson 6.1 established that a chat model is stateless and "memory" is really the application re-sending the transcript. LangChain's memory components formalize *how* that re-sent context is assembled and trimmed — a simple buffer of the last N messages, a summarizing memory that periodically compresses old turns into a shorter summary (to manage context-window budget, Course 1 Lesson 7.1), or memory backed by a vector store for semantic recall of older, relevant-but-not-recent turns.

## 2.6 Document loaders, splitters, and vector store integrations

For RAG use cases specifically (full mechanism in Lesson 4), LangChain provides standardized loaders for pulling in documents from dozens of source types (PDFs, websites, Notion, Google Drive, databases…), text splitters implementing common chunking strategies, and a common interface across most popular vector databases (Pinecone, Chroma, Weaviate, pgvector, and others) — again, the value is that swapping the underlying vector database doesn't require rewriting the retrieval logic around it.

## 2.7 Where LangChain gets criticized, honestly

It's worth knowing the common, legitimate critiques, since they inform when teams reach for LangGraph instead (Lesson 3) or drop the framework entirely for simple cases:

- **Abstraction overhead for simple cases.** A single LLM call with one prompt often doesn't need a chain — some teams find LangChain's abstractions add indirection without payoff for small use cases, and just call the provider's SDK directly.
- **Debugging depth.** Because a chain wraps several layers of abstraction, tracing exactly what prompt text actually reached the model can require extra tooling (LangSmith, LangChain's own observability product, exists largely to address this).
- **Linear-chain limitations for genuinely agentic workflows.** Chains model an essentially linear (or simple branching) pipeline well, but real agents often need loops, conditional branches, retries, and parallel paths based on runtime state — which is exactly the gap LangGraph (built by the same team, Lesson 3) was created to fill.

## 2.8 LangChain vs. calling a provider SDK directly

| | Raw provider SDK (OpenAI/Anthropic SDK) | LangChain |
| --- | --- | --- |
| Switching providers | Rewrite call sites | Swap one component |
| Simple single-call use case | Very direct, minimal overhead | Some abstraction overhead |
| RAG / multi-step chains | Hand-wire everything | Standardized loaders, splitters, chain composition |
| Complex agent control flow (loops, branches) | Fully manual | Better served by LangGraph (Lesson 3) than base LangChain |

> **Review question**
> A team's chatbot needs to: (1) look up a user's order in a database, (2) summarize the company's return policy from a PDF, and (3) draft a reply combining both. Which specific LangChain building blocks from this lesson would each of those three steps use, and why would a plain, hand-written script become harder to maintain than a chain as more steps like this get added?
