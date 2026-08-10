> **Learning goal**
> Confidently pick between association, aggregation, and composition for any pair of related classes — the single distinction interviewers use most often to probe whether you've actually thought about object ownership and lifetime.

These three relationships all mean "one class holds a reference to another," but they answer three different questions: *does A own B? Can B outlive A? Does A create B?* Getting this right is what separates a design that "compiles" from one that actually models the domain correctly.

## 4.1 Association — the loosest link

Two classes know about each other, but neither owns the other, and both have completely independent lifetimes.

```java
class Teacher {
    private String name;
}

class Course {
    private String title;
    private Teacher teacher; // Course knows about a Teacher...
}
```

A `Teacher` exists whether or not any `Course` references them, and a `Course` can be reassigned to a different `Teacher`. Neither side is responsible for creating or destroying the other. This is the default, weakest relationship — reach for it when two objects simply need to talk to or reference each other.

## 4.2 Aggregation — a "has-a" without ownership of lifetime

One class conceptually contains a collection of another, but the contained objects can exist independently and outlive the container.

```java
class Book {
    private String isbn;
}

class Library {
    private List<Book> books = new ArrayList<>(); // Library aggregates Books

    void addBook(Book book) { books.add(book); } // Books are passed in, not created here
}
```

If a `Library` is deleted, its `Book` objects don't cease to exist — they might get transferred to another library. The key signal in code: the container receives already-constructed objects (via a setter, constructor parameter, or `add` method) rather than instantiating them itself. Drawn with a **hollow diamond** at the container end.

## 4.3 Composition — ownership and shared lifetime

One class creates, owns, and destroys another; the parts have no independent existence outside the whole.

```java
class Room {
    private double area;
}

class House {
    private final List<Room> rooms = new ArrayList<>();

    House(int roomCount) {
        for (int i = 0; i < roomCount; i++) {
            rooms.add(new Room()); // House creates its own Rooms
        }
    }
}
```

A `Room` here has no meaning outside its `House` — it's created inside the constructor and destroyed when the `House` is garbage collected. Drawn with a **filled diamond** at the owner end. Composition is the strongest coupling of the three and should be your default when a "part" object genuinely can't be meaningfully shared or reused elsewhere.

## 4.4 A decision checklist

Ask these three questions, in order, about any A/B pair:

1. **Could B exist meaningfully with no A at all?** If yes → association or aggregation. If no → composition.
2. **Does A create B internally (in a constructor/factory method), or does A just receive an already-built B?** Creates it → leans composition. Receives it → leans aggregation or association.
3. **If A is destroyed, should B be destroyed too?** Yes → composition. No → aggregation or association.

| Pair | Answer | Relationship |
| --- | --- | --- |
| `Order` / `OrderLine` | An `OrderLine` (2× shirt, size M) means nothing without its `Order` | Composition |
| `Order` / `Customer` | A `Customer` exists long before and after any single `Order` | Association |
| `ParkingLot` / `ParkingSpot` | Spots are built into the lot but conceptually numbered/managed independently | Aggregation |
| `Car` / `Engine` | Depends on the domain — a specific engine instance permanently installed in one car → composition | Composition |

## 4.5 Why this matters beyond terminology

This isn't academic vocabulary — it directly decides your constructors, your `delete`/cleanup logic, and your API. Composition usually means the parent's constructor builds the children and there's no public "detach" method. Aggregation usually means an `addX`/`removeX` API and the children are constructed (or looked up) elsewhere. Getting this wrong produces classes that are hard to test (composition where you needed aggregation, so you can't inject a mock) or that leak memory/orphaned records (aggregation where you needed composition, so nothing ever cleans up the parts).

> **Review question**
> For a `Playlist` and a `Song`: is this association, aggregation, or composition? What changes about your answer if the same `Song` object can appear in multiple different playlists simultaneously?
