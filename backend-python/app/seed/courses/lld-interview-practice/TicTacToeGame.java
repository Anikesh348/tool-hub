/**
 * Complete reference implementation for the Tic-Tac-Toe LLD problem:
 * generalized N x N board with O(1) incremental win detection.
 *   javac TicTacToeGame.java && java TicTacToeGame
 */
public class TicTacToeGame {

    static class Player {
        private final String name;
        private final int value; // +1 for player 1, -1 for player 2
        private final char symbol;

        Player(String name, int value, char symbol) {
            this.name = name;
            this.value = value;
            this.symbol = symbol;
        }

        String getName() { return name; }
        int getValue() { return value; }
        char getSymbol() { return symbol; }
    }

    static class Board {
        private final int n;
        private final char[][] grid;
        private final int[] rowCount;
        private final int[] colCount;
        private int diagonalCount = 0;
        private int antiDiagonalCount = 0;
        private int movesPlayed = 0;

        Board(int n) {
            this.n = n;
            this.grid = new char[n][n];
            this.rowCount = new int[n];
            this.colCount = new int[n];
            for (char[] row : grid) java.util.Arrays.fill(row, '.');
        }

        boolean isValidMove(int row, int col) {
            return row >= 0 && row < n && col >= 0 && col < n && grid[row][col] == '.';
        }

        /** Places a mark and returns true if this move produced a win. */
        boolean placeMark(int row, int col, Player player) {
            grid[row][col] = player.getSymbol();
            movesPlayed++;
            rowCount[row] += player.getValue();
            colCount[col] += player.getValue();
            if (row == col) diagonalCount += player.getValue();
            if (row + col == n - 1) antiDiagonalCount += player.getValue();

            return Math.abs(rowCount[row]) == n || Math.abs(colCount[col]) == n
                    || Math.abs(diagonalCount) == n || Math.abs(antiDiagonalCount) == n;
        }

        boolean isFull() { return movesPlayed == n * n; }

        void print() {
            for (char[] row : grid) {
                StringBuilder sb = new StringBuilder();
                for (char c : row) sb.append(c).append(' ');
                System.out.println(sb.toString().trim());
            }
        }
    }

    static class Game {
        private final Board board;
        private final Player[] players;
        private int turn = 0;

        Game(int size, Player playerOne, Player playerTwo) {
            this.board = new Board(size);
            this.players = new Player[]{playerOne, playerTwo};
        }

        /** Returns the winning Player, or null if the move didn't end the game. */
        Player play(int row, int col) {
            Player current = players[turn % 2];
            if (!board.isValidMove(row, col)) {
                System.out.println("Invalid move at (" + row + "," + col + "), try again.");
                return null;
            }
            boolean won = board.placeMark(row, col, current);
            turn++;
            if (won) return current;
            if (board.isFull()) return null; // draw handled by caller checking isFull()
            return null;
        }

        Board getBoard() { return board; }
    }

    public static void main(String[] args) {
        Player x = new Player("Alice", 1, 'X');
        Player o = new Player("Bob", -1, 'O');
        Game game = new Game(3, x, o);

        int[][] moves = {{0, 0}, {1, 1}, {0, 1}, {2, 2}, {0, 2}}; // Alice completes top row
        Player winner = null;
        for (int[] move : moves) {
            winner = game.play(move[0], move[1]);
            if (winner != null) break;
        }

        game.getBoard().print();
        if (winner != null) {
            System.out.println(winner.getName() + " wins!");
        } else if (game.getBoard().isFull()) {
            System.out.println("Draw!");
        }
    }
}
