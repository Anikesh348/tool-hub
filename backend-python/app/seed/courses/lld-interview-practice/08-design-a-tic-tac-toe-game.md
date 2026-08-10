> **Learning goal**
> A small, self-contained board-game problem — good for practicing clean separation between board state, players, and win-detection logic before the more involved Chess problem (lesson 9).

## 8.1 Requirements and scope

**Functional requirements:** two players alternate placing marks (X/O) on an N×N board; the game detects a win (a full row, column, or diagonal of one mark) or a draw (board full, no winner); an attempt to play an occupied cell or play out of turn is rejected.

**Non-functional constraints:** support any board size N (not hardcoded to 3×3) — this is a common follow-up an interviewer adds to see if your win-detection generalizes.

**Non-goals:** AI opponent, network multiplayer, UI rendering.

## 8.2 Core objects and responsibilities

| Class | Responsibility |
| --- | --- |
| `Board` | Holds the grid, validates and applies moves |
| `Player` | A symbol (X/O) and a name |
| `Game` | Owns the board and players, enforces turn order, asks the board to check for a winner after each move |
| `WinningStrategy` | Determines whether the last move produced a win — kept separate so the win *rule* can vary |

## 8.3 Class design

```text
Game "1" *--> "1" Board
Game "1" *--> "2" Player
Game "1" --> "1" WinningStrategy
```

## 8.4 Key design decisions

**Naive win-checking is O(N²) per move; incremental checking is O(N).** A naive `checkWinner()` scans every row, column, and both diagonals from scratch after every move — fine for 3×3, but wasteful for large N. A better approach: maintain running counts per row, column, and each diagonal (`rowCounts[N]`, `colCounts[N]`, plus two diagonal counters), incrementing the relevant counters by `+1` for player 1 or `-1` for player 2 on each move, and checking only whether any counter has reached `±N` — turning each move's win-check into O(1) instead of rescanning the whole board.

```java
int[] rowCount = new int[n];
int[] colCount = new int[n];
int diagonalCount = 0;
int antiDiagonalCount = 0;

boolean placeMark(int row, int col, int playerValue) { // +1 or -1
    rowCount[row] += playerValue;
    colCount[col] += playerValue;
    if (row == col) diagonalCount += playerValue;
    if (row + col == n - 1) antiDiagonalCount += playerValue;
    return Math.abs(rowCount[row]) == n || Math.abs(colCount[col]) == n
        || Math.abs(diagonalCount) == n || Math.abs(antiDiagonalCount) == n;
}
```

**`WinningStrategy` as an interface, not hardcoded logic.** Isolating "what counts as a win" behind an interface (Strategy, LLD Basics lesson 14) means a variant like "4 in a row on a larger board" (Connect Four-style) is a new strategy implementation, not a rewrite of `Game`.

**Turn enforcement lives in `Game`, not `Board`.** `Board` should only know "is this cell empty, can I place a mark here" — whose turn it is is game-flow logic, not board state, keeping `Board` reusable for other turn-order rules (e.g. a variant where a player can move twice).

## 8.5 Walking through the scenarios

*Win:* player X completes a row → `Board.placeMark` returns true from the incremental check → `Game` declares X the winner and ends the game.

*Draw:* board fills completely with no counter ever reaching ±N → `Game` checks `movesPlayed == n*n` and declares a draw.

*Invalid move:* a player tries to play a filled cell → `Board` rejects it without mutating any state, and `Game` does not advance the turn.

> **Review question**
> How would the O(1) incremental win-check need to change to support a "4 in a row anywhere" rule on a board larger than 4×4 (not just full rows/columns/diagonals)?
