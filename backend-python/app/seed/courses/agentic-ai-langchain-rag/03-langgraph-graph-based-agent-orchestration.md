> **Learning goal**
> Understand why real agentic systems are modeled as graphs rather than linear chains, and how LangGraph's core primitives (state, nodes, edges) work together.

## 3.1 The limitation LangGraph exists to fix

A **chain** (Lesson 2.2) is fundamentally a straight line, or at best a simple tree: step A always leads to step B. Real agent behavior is rarely that shape. Consider a customer support agent: it might need to *loop* ("search again with different terms if the first search found nothing"), *branch conditionally* ("if the user is asking about billing, go to the billing tool; otherwise go to general search"), or *require a human checkpoint* ("pause here for approval before issuing a refund"). Forcing that into a linear chain means bolting on increasingly awkward manual control flow. LangGraph, released by the LangChain team in early 2024, models an agent as an explicit **graph** instead, where loops and conditional branches are first-class, not workarounds.

## 3.2 The three core primitives

- **State** — a single shared data structure (typically a typed dictionary or object) that represents "everything the agent currently knows" — conversation history, retrieved documents, intermediate results, a scratchpad. Every node reads from and writes to this same state.
- **Nodes** — individual units of work (a Python function or a `Runnable` from Lesson 2.2): call the LLM, run a tool, call a retriever, run validation logic. Each node takes the current state in and returns updates to it.
- **Edges** — connections between nodes describing what runs next. A **normal edge** always goes to the same next node. A **conditional edge** runs a small routing function against the current state and picks *which* node to go to next, based on runtime data — this is what makes branching and looping possible.

```text
        +-------------+
        |   retrieve   |
        +------+------+
               |
               v
        +-------------+        found nothing?
        |   generate   +-----------------------> back to "retrieve" (loop)
        +------+------+                          with a refined query
               |
   conditional edge: needs a tool?
         /                \
        v                  v
  +-----------+      +-----------+
  |   tool     |      |   END      |
  +-----+-----+      +-----------+
        |
        v
  back to "generate" (loop)
```

## 3.3 Why "graph" is the right word, not just marketing

This is literally the computer-science graph structure — nodes and directed edges — and the framework's execution engine is a graph traversal: starting at an entry node, repeatedly executing the current node, then following whichever edge (normal or conditional) applies, until it reaches a designated `END` node. Loops are simply cycles in the graph — a conditional edge that can route back to an earlier node — which a purely linear chain abstraction cannot represent without external control logic wrapped around it.

## 3.4 Persistence, checkpoints, and human-in-the-loop

Because LangGraph tracks state explicitly at every node boundary, it can **checkpoint** that state to a database after each step. This unlocks two things chains struggle with:

- **Resumability.** If a long-running agent crashes or a process restarts mid-task, execution can resume from the last checkpoint instead of starting over.
- **Human-in-the-loop interrupts.** A graph can be configured to pause *before* a specific node — e.g., "before executing a refund tool call" — wait for human approval injected into the state, and only then continue. This is a direct, practical answer to the risk raised in Lesson 1.5: giving a human a real, structural checkpoint before a risky action, rather than relying on the model to just decide not to.

## 3.5 Multi-agent systems as graphs

Because a node can itself be an entire sub-agent (an LLM with its own tools and even its own sub-graph), LangGraph is also the common way to build **multi-agent** systems: a "supervisor" node that reads a task and routes it to one of several specialist agent-nodes (a research agent, a coding agent, a writing agent), each potentially running their own internal loop, with results flowing back to the supervisor to combine. Lesson 6 covers why multi-agent decomposition is used in production and its real trade-offs, but the graph structure here is what makes routing between specialist agents an explicit, inspectable edge rather than an implicit prompt instruction.

## 3.6 LangChain vs. LangGraph — when to reach for which

| | LangChain (chains) | LangGraph |
| --- | --- | --- |
| Control flow shape | Linear / simple branch | Arbitrary graph, including cycles |
| Looping ("retry until good") | Awkward, manual | Native (conditional edge back to an earlier node) |
| Long-running/resumable tasks | Not built in | Native checkpointing |
| Human-approval pauses | Manual | Native interrupt-before-node support |
| Simple single-pass RAG or Q&A | A great, simpler fit | Overkill |
| Multi-agent orchestration | Possible but manual | A core designed-for use case |

In practice, most production LangGraph applications still use LangChain's components (prompt templates, model wrappers, tool definitions from Lesson 2) *inside* individual graph nodes — the two are complementary layers, not competitors: LangChain standardizes the individual building blocks; LangGraph standardizes how those blocks are wired into control flow.

> **Review question**
> Design (on paper, no code needed) a LangGraph graph for an agent that answers a user's question using RAG, but must retry retrieval with a reworded query if the first retrieval comes back empty, and must ask a human for approval before it's allowed to send an email. Name the nodes, and identify which edges must be conditional rather than normal, and why.
