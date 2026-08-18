> **Learning goal**
> A broader-scope "system" problem (as opposed to a single device/machine) — good practice for modeling several interacting entities and their multiplicities correctly.

## 7.1 Requirements and scope

**Functional requirements:** the library has books, each with multiple physical copies; members can search the catalog, check out an available copy, and return it; checkouts have a due date, and overdue returns incur a fine; the library tracks each member's currently checked-out books.

**Non-functional constraints:** in-memory catalog and membership records.

**Non-goals:** book reservations/holds queue, inter-library loans, digital/e-book lending.

## 7.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Book` | Catalog-level metadata (title, author, ISBN) — one `Book` can have many physical copies |
| `BookCopy` | One physical, checkoutable copy of a `Book`, with its own availability status |
| `Member` | A library member and their checkout history |
| `Checkout` | Records which `BookCopy` a `Member` borrowed, when, and the due date |
| `Library` | Owns the catalog and members, coordinates checkout/return, computes fines |

## 7.3 Class design

```text
Book "1" *--> "1..*" BookCopy       (a title has several physical copies)
Library "1" *--> "0..*" Book
Library "1" *--> "0..*" Member
Checkout "1" --> "1" BookCopy
Checkout "1" --> "1" Member
```

`Book`/`BookCopy` is composition — a copy has no meaning without its title. `Library`/`Member` is association — members exist independently of any specific library operation.

## 7.4 Key design decisions

**`Book` vs. `BookCopy` — the multiplicity that trips people up.** A common mistake is modeling "3 copies of a book" as three separate `Book` objects with duplicated metadata — that breaks the moment the catalog needs to update a shared field (e.g. correcting the author's name) across every copy. Splitting `Book` (shared metadata) from `BookCopy` (per-physical-item status) fixes this, and mirrors how a real library's ISBN-vs-barcode system works.

**Checkout as its own entity, not a boolean flag.** Resist modeling availability as just `BookCopy.isAvailable = true/false` with the due date living elsewhere — a `Checkout` object (member + copy + checkout date + due date + returned date) is what lets you answer "who had this book last March" or compute a fine, and it's a natural composition target for `Member`'s history.

**Fine calculation as a pluggable strategy.** Like the Parking Lot's `FeeCalculator` (lesson 2), fine computation (`$0.50/day` overdue, capped at some maximum) is best isolated behind a `FineCalculator` interface — different member types (student vs. faculty) might have different rates, which is exactly Strategy (LLD Basics lesson 14) again.

## 7.5 Walking through the scenarios

*Checkout:* member searches catalog for "Clean Code" → `Library` finds a `Book` with an available `BookCopy` → creates a `Checkout` (due date = today + 14 days), marks the copy unavailable.

*Return, on time:* `Library.returnBook(copyId)` finds the open `Checkout`, marks the copy available again, sets `returnedDate` — no fine.

*Return, overdue:* same flow, but `FineCalculator.calculate(checkout, today)` computes a nonzero fine based on days past the due date.

*No copies available:* `Library.checkout(...)` for a fully-checked-out title should return a clear "unavailable" result rather than silently failing — good place to mention a future reservation-queue extension even though it's out of scope here.

> **Review question**
> A member tries to check out a book while they already have 2 overdue books. Where does this business rule belong — on `Library`, `Member`, or a separate policy object — and why?
