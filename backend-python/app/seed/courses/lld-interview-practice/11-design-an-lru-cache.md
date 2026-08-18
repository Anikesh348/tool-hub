> **Learning goal**
> Design a fixed-capacity cache with O(1) get and put — the interview problem that most directly tests whether you can combine two data structures to hit a specific complexity target.

## 11.1 Requirements and scope

**Functional requirements:** `get(key)` returns the value if present (and marks it most-recently-used), or a sentinel/`null` if absent; `put(key, value)` inserts or updates a value; when inserting past capacity, evict the *least* recently used entry.

**Non-functional constraints:** both `get` and `put` must run in O(1) time — this constraint is the entire point of the problem, and the reason a plain `LinkedHashMap`-only or array-only solution isn't a complete answer without explaining *why* it hits O(1).

**Non-goals:** thread safety (mention it, but a single-threaded reference implementation is the expected scope unless the interviewer asks for concurrent access explicitly).

## 11.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `LruCache` | Public `get`/`put` API, owns both internal structures below |
| `Node` (private, doubly-linked list) | key + value + prev/next pointers |
| `HashMap<K, Node>` | O(1) lookup from key straight to its list node |
| Doubly-linked list (`head`/`tail` sentinels) | Maintains recency order; front = most recent, back = least recent |

## 11.3 Why two data structures, not one

A plain `HashMap` gives O(1) lookup but no ordering — you can't cheaply find "the least recently used" entry. A plain linked list gives you ordering (move-to-front is O(1) once you have the node) but O(N) lookup by key. **Combining them** — hash map for O(1) key → node lookup, doubly-linked list for O(1) reordering and O(1) eviction from the tail — gets both properties at once. This pairing (hash map + doubly-linked list) is worth naming explicitly; it's the crux of the entire problem.

```text
HashMap<K, Node>          Doubly-linked list (MRU -> LRU)
  "a" -> Node(a) --------> head <-> Node(c) <-> Node(a) <-> Node(b) <-> tail
  "b" -> Node(b) ----------------------------------------------^
  "c" -> Node(c) --------------------^
```

## 11.4 Key design decisions

**Sentinel head/tail nodes avoid null-checking edge cases.** Using dummy `head` and `tail` nodes that are always present (never holding real data) means insert/remove logic never has to special-case "is this the first/last real node" — every real node always has a genuine `prev` and `next` to relink.

```java
class Node {
    int key, value;
    Node prev, next;
    Node(int key, int value) { this.key = key; this.value = value; }
}

class LruCache {
    private final int capacity;
    private final Map<Integer, Node> map = new HashMap<>();
    private final Node head = new Node(0, 0);
    private final Node tail = new Node(0, 0);

    LruCache(int capacity) {
        this.capacity = capacity;
        head.next = tail;
        tail.prev = head;
    }

    private void remove(Node node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void insertAtFront(Node node) {
        node.next = head.next;
        node.prev = head;
        head.next.prev = node;
        head.next = node;
    }

    int get(int key) {
        if (!map.containsKey(key)) return -1;
        Node node = map.get(key);
        remove(node);
        insertAtFront(node); // accessing counts as "used" -> move to MRU position
        return node.value;
    }

    void put(int key, int value) {
        if (map.containsKey(key)) remove(map.get(key));
        else if (map.size() == capacity) {
            Node lru = tail.prev; // least recently used = right before the tail sentinel
            remove(lru);
            map.remove(lru.key);
        }
        Node node = new Node(key, value);
        map.put(key, node);
        insertAtFront(node);
    }
}
```

## 11.5 Where you'll use this

Beyond being a standalone question, LRU eviction is the underlying mechanism behind real caching layers (browser caches, CDN edge caches, database buffer pools) — mentioning that connection shows you understand *why* this data structure combination matters beyond the puzzle itself.

> **Review question**
> How would you extend this design to an **LFU** (Least Frequently Used) cache instead — same O(1) requirement, but evicting the entry with the lowest access count rather than the oldest access time? What extra bookkeeping does that require?
