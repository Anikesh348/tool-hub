> **Learning goal**
> Create new objects by cloning an existing, pre-configured instance instead of constructing from scratch — and know the difference between a shallow clone (that silently shares mutable state) and a deep clone (that doesn't).

## 8.1 The problem: expensive or complex construction

Some objects are costly or awkward to build from a raw constructor — maybe construction involves a database read, a network call, or simply setting up a lot of nested configuration. If you already *have* a fully-configured instance sitting around, it can be cheaper to copy it than to rebuild one from zero.

```java
// Expensive to construct fresh each time
GameCharacter template = GameCharacter.loadFromDatabase("orc-warrior");
// Every spawn: another full database round-trip
GameCharacter enemy1 = GameCharacter.loadFromDatabase("orc-warrior");
GameCharacter enemy2 = GameCharacter.loadFromDatabase("orc-warrior");
```

## 8.2 The Prototype solution

Define a `clone()` method on the object itself, and produce new instances by copying an existing prototype instead of re-running expensive construction logic.

```java
interface Prototype<T> {
    T clone();
}

class GameCharacter implements Prototype<GameCharacter> {
    private String name;
    private int health;
    private List<String> abilities;

    GameCharacter(String name, int health, List<String> abilities) {
        this.name = name;
        this.health = health;
        this.abilities = new ArrayList<>(abilities);
    }

    @Override
    public GameCharacter clone() {
        return new GameCharacter(this.name, this.health, this.abilities); // deep-copies the list
    }
}

GameCharacter template = new GameCharacter("Orc Warrior", 100, List.of("Slam", "Roar"));
GameCharacter enemy1 = template.clone();
GameCharacter enemy2 = template.clone();
```

Each `clone()` call is just object copying — no database, no re-parsing configuration.

## 8.3 Shallow vs. deep copy — the trap

Java's built-in `Object.clone()` (and a naive hand-written clone) performs a **shallow copy** by default: primitive fields are copied by value, but reference fields (like `List<String> abilities`) are copied by reference, meaning the original and the clone end up pointing at the *same* underlying list.

```java
// DANGEROUS shallow clone
class GameCharacter {
    private List<String> abilities;
    GameCharacter shallowClone() {
        GameCharacter copy = new GameCharacter();
        copy.abilities = this.abilities; // same List object!
        return copy;
    }
}

GameCharacter clone = template.shallowClone();
clone.abilities.add("Poison"); // mutates template's list too — a shared-state bug
```

The fix, shown in section 8.2's `GameCharacter`, is a **deep copy**: explicitly construct new instances of every mutable field (`new ArrayList<>(abilities)`) so the clone owns its own independent state. The rule of thumb: any field that's an array, collection, or reference to another mutable object needs to be explicitly deep-copied; primitives and immutable types (like `String`) are safe to copy directly.

## 8.4 Prototype vs. Builder vs. Factory Method

These three creational patterns solve different problems and are easy to conflate:

| Pattern | Answers | Starting point |
| --- | --- | --- |
| Factory Method | "Which concrete class do I instantiate?" | Nothing — builds fresh |
| Builder | "How do I assemble an object with many optional parts?" | Nothing — builds fresh, step by step |
| Prototype | "How do I get a new object cheaply when I already have one like it?" | An existing instance |

Prototype is the only one of the three that requires an existing object to copy from — it's specifically about avoiding repeated expensive construction, not about organizing construction logic.

## 8.5 Where you'll use this

Spawning many similar enemies/objects in a game, cloning a default `Order` template for a recurring-subscription checkout flow, or duplicating a saved document as a starting point for a new one are all Prototype use cases.

> **Review question**
> `GameCharacter` gains a new field, `Map<String, Integer> inventory`. What does the `clone()` method need to do to stay a correct deep copy?
