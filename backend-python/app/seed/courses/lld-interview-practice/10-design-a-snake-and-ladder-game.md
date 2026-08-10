> **Learning goal**
> A light, mechanics-focused board game problem — good for practicing how to model board "special cells" (snakes, ladders) as data rather than conditional logic.

## 10.1 Requirements and scope

**Functional requirements:** a board of N cells (typically 100); players take turns rolling a die and moving forward; landing on a cell with a snake's head sends the player down to the snake's tail; landing on a ladder's bottom sends the player up to its top; the first player to reach exactly the final cell wins (an overshoot doesn't move the player, in the standard rule variant).

**Non-functional constraints:** in-memory, supports any number of players and any board configuration.

**Non-goals:** networked multiplayer, animated UI.

## 10.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Board` | Cell count, and a lookup of snake/ladder jumps by starting cell |
| `Snake` / `Ladder` | A `(start, end)` pair; both can be modeled as one `Jump` concept |
| `Player` | Current position, name |
| `Dice` | Rolls a random value in range |
| `Game` | Owns the board, players, dice; runs turns until someone wins |

## 10.3 Class design

```text
Game "1" *--> "1" Board
Board "1" *--> "0..*" Jump   (snakes and ladders are both just jumps)
Game "1" *--> "2..*" Player
Game "1" *--> "1" Dice
```

## 10.4 Key design decisions

**Snakes and ladders are the same abstraction, just opposite direction.** Rather than two separate classes with duplicated lookup logic, model both as a single `Jump(start, end)` record — a "snake" is simply a jump where `end < start`, a "ladder" is one where `end > start`. `Board` just needs one `Map<Integer, Integer>` from cell → destination cell, built from all jumps; the game loop doesn't need to know or care which kind of jump it hit.

```java
record Jump(int start, int end) {}

class Board {
    private final int size;
    private final Map<Integer, Integer> jumps;

    Board(int size, List<Jump> jumps) {
        this.size = size;
        this.jumps = new HashMap<>();
        for (Jump j : jumps) this.jumps.put(j.start(), j.end());
    }

    int resolveLanding(int cell) {
        return jumps.getOrDefault(cell, cell); // follow one jump if the cell has one, else stay put
    }
}
```

**No overshoot rule.** If a player is on cell 97 and rolls a 5 (landing on 102, past a 100-cell board), the standard rule is the player doesn't move at all this turn — `Game` needs to check `currentPosition + roll <= boardSize` before applying the move, otherwise the turn is simply skipped.

**Chained jumps — a deliberate design decision to disallow (or explicitly allow).** Could a ladder's top cell itself be a snake's head, causing a chain of jumps in one turn? Real board games disallow this by construction (validated when the board is set up); state this assumption explicitly rather than silently handling or silently breaking on it — a `resolveLanding` that only follows one jump enforces "no chaining" by construction, matching the reference implementation above.

## 10.5 Walking through the scenarios

*Normal move:* player at cell 20 rolls a 4 → lands on 24, no jump at 24 → stays at 24.

*Ladder:* player at cell 20 rolls a 4 → lands on 24, which has a ladder to 50 → player ends the turn at 50.

*Overshoot:* player at cell 98 rolls a 5 → 103 exceeds the 100-cell board → move is rejected, turn passes to the next player, position stays 98.

*Win:* a player's move lands them exactly on cell 100 → `Game` declares them the winner and ends the game immediately, even mid-round with other players still to move.

> **Review question**
> Two players land on the exact same cell. Should this be allowed (both occupy the cell) or should the second player "bump" the first back to their previous position (a house rule some versions use)? How would you make this configurable without changing `Game`'s core loop?
