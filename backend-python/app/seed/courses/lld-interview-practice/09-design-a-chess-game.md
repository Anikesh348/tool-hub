> **Learning goal**
> The classic "deepest" LLD interview problem — modeling several pieces with genuinely different movement rules cleanly, without a giant switch statement.

## 9.1 Requirements and scope

**Functional requirements:** an 8×8 board with standard pieces (king, queen, rook, bishop, knight, pawn) for two players; each piece type has its own legal-move rules; the game detects check (and, if time allows, checkmate); moves alternate between players; captured pieces are removed from the board.

**Non-functional constraints:** in-memory, single game instance.

**Non-goals:** full checkmate/stalemate detection edge cases (castling, en passant, pawn promotion) — mention these exist and how you'd extend the design, but don't implement all of them under interview time pressure. This reference implementation includes basic movement + check detection, and calls out where castling/en passant would plug in.

## 9.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Board` | 8×8 grid of squares, knows what piece (if any) occupies each square |
| `Piece` (abstract) | Color and current position; each subclass defines its own `getPossibleMoves(board)` |
| `King`, `Queen`, `Rook`, `Bishop`, `Knight`, `Pawn` | Concrete pieces, each overriding move-generation |
| `Player` | Color, owns captured-piece history |
| `Game` | Owns the board, alternates turns, validates a requested move against the moving piece's legal moves, detects check |

## 9.3 Class design

```text
Game "1" *--> "1" Board
Board "1" *--> "0..32" Piece
Game "1" *--> "2" Player
Piece <|-- King, Queen, Rook, Bishop, Knight, Pawn   (inheritance, LLD Basics lesson 1)
```

## 9.4 Key design decisions

**Polymorphic move generation, not one giant switch.** Each `Piece` subclass implements its own `getPossibleMoves(Board)`, returning the squares it could move to *ignoring check* — this is directly LLD Basics lesson 1's polymorphism example, scaled up: `Game` never needs to know which concrete piece it's asking, it just calls `piece.getPossibleMoves(board)`.

```java
abstract class Piece {
    protected final Color color;
    protected Position position;
    abstract List<Position> getPossibleMoves(Board board);
}

class Knight extends Piece {
    List<Position> getPossibleMoves(Board board) {
        int[][] offsets = {{1,2},{2,1},{-1,2},{-2,1},{1,-2},{2,-1},{-1,-2},{-2,-1}};
        List<Position> moves = new ArrayList<>();
        for (int[] o : offsets) {
            Position candidate = position.offsetBy(o[0], o[1]);
            if (board.isOnBoard(candidate) && !board.isOccupiedByColor(candidate, color)) {
                moves.add(candidate);
            }
        }
        return moves;
    }
}
```

**"Possible" moves vs. "legal" moves — a subtlety worth naming out loud.** A piece's raw `getPossibleMoves` might include a move that would leave the mover's own king in check (illegal in real chess). `Game.getLegalMoves(piece)` should filter `getPossibleMoves` down to those that don't result in self-check — simulate the move, check if the king is attacked, and revert. Naming this distinction explicitly is exactly the kind of depth interviewers are listening for.

**Check detection.** After any move, scan whether the opposing king's square is in any piece's `getPossibleMoves` set — if so, that king is in check. This reuses the same polymorphic move generation with no extra per-piece logic.

**Where castling/en passant/promotion would plug in.** These are special-cased extra moves layered on top of a piece's normal move set (`King`/`Rook` jointly for castling, `Pawn` for the other two) — worth mentioning as a `SpecialMoveRule` extension point rather than implementing under time pressure.

## 9.5 Walking through a scenario

White moves a knight to a square that attacks the black king → `Game.move(...)` applies the move → `Game` checks all of white's pieces' possible moves against black king's square → detects check → informs black they must make a move that resolves it (either block, capture the attacker, or move the king) on their next turn.

> **Review question**
> A `Bishop`'s `getPossibleMoves` needs to stop scanning further along a diagonal once it hits any piece (friendly or enemy) — capturing the enemy piece's square but not moving past it. Sketch that loop.
