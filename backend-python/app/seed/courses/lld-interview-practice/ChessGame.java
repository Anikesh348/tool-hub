import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Complete reference implementation for the Chess LLD problem: polymorphic
 * per-piece move generation, a basic check detector, and hooks noting where
 * castling/en passant/promotion would extend the design.
 *   javac ChessGame.java && java ChessGame
 */
public class ChessGame {

    enum Color { WHITE, BLACK }

    record Position(int row, int col) {
        Position offsetBy(int dr, int dc) { return new Position(row + dr, col + dc); }
    }

    abstract static class Piece {
        protected final Color color;
        protected Position position;

        Piece(Color color, Position position) {
            this.color = color;
            this.position = position;
        }

        Color getColor() { return color; }
        Position getPosition() { return position; }
        void moveTo(Position position) { this.position = position; }
        abstract List<Position> getPossibleMoves(Board board);
        abstract char getSymbol();
    }

    static class Knight extends Piece {
        Knight(Color color, Position position) { super(color, position); }

        List<Position> getPossibleMoves(Board board) {
            int[][] offsets = {{1, 2}, {2, 1}, {-1, 2}, {-2, 1}, {1, -2}, {2, -1}, {-1, -2}, {-2, -1}};
            List<Position> moves = new ArrayList<>();
            for (int[] o : offsets) {
                Position candidate = position.offsetBy(o[0], o[1]);
                if (board.isOnBoard(candidate) && !board.isOccupiedByColor(candidate, color)) {
                    moves.add(candidate);
                }
            }
            return moves;
        }

        char getSymbol() { return color == Color.WHITE ? 'N' : 'n'; }
    }

    static class Bishop extends Piece {
        Bishop(Color color, Position position) { super(color, position); }

        List<Position> getPossibleMoves(Board board) {
            List<Position> moves = new ArrayList<>();
            int[][] directions = {{1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
            for (int[] dir : directions) {
                Position candidate = position.offsetBy(dir[0], dir[1]);
                while (board.isOnBoard(candidate)) {
                    if (board.isOccupiedByColor(candidate, color)) break; // blocked by own piece
                    moves.add(candidate);
                    if (board.isOccupied(candidate)) break; // captures enemy piece, stop scanning further
                    candidate = candidate.offsetBy(dir[0], dir[1]);
                }
            }
            return moves;
        }

        char getSymbol() { return color == Color.WHITE ? 'B' : 'b'; }
    }

    static class King extends Piece {
        King(Color color, Position position) { super(color, position); }

        List<Position> getPossibleMoves(Board board) {
            List<Position> moves = new ArrayList<>();
            for (int dr = -1; dr <= 1; dr++) {
                for (int dc = -1; dc <= 1; dc++) {
                    if (dr == 0 && dc == 0) continue;
                    Position candidate = position.offsetBy(dr, dc);
                    if (board.isOnBoard(candidate) && !board.isOccupiedByColor(candidate, color)) {
                        moves.add(candidate);
                    }
                }
            }
            // Castling would be layered on here as an additional special move,
            // conditioned on neither King nor Rook having moved yet.
            return moves;
        }

        char getSymbol() { return color == Color.WHITE ? 'K' : 'k'; }
    }

    static class Board {
        private final Map<Position, Piece> squares = new HashMap<>();

        void place(Piece piece) { squares.put(piece.getPosition(), piece); }

        boolean isOnBoard(Position p) { return p.row() >= 0 && p.row() < 8 && p.col() >= 0 && p.col() < 8; }
        boolean isOccupied(Position p) { return squares.containsKey(p); }
        boolean isOccupiedByColor(Position p, Color color) {
            Piece piece = squares.get(p);
            return piece != null && piece.getColor() == color;
        }

        Piece pieceAt(Position p) { return squares.get(p); }

        void move(Piece piece, Position to) {
            squares.remove(piece.getPosition());
            squares.put(to, piece); // capture, if any, is simply overwritten
            piece.moveTo(to);
        }

        List<Piece> piecesOf(Color color) {
            List<Piece> result = new ArrayList<>();
            for (Piece piece : squares.values()) {
                if (piece.getColor() == color) result.add(piece);
            }
            return result;
        }
    }

    static class Game {
        private final Board board = new Board();

        boolean isInCheck(Color kingColor) {
            Position kingPos = board.piecesOf(kingColor).stream()
                    .filter(p -> p instanceof King)
                    .findFirst()
                    .map(Piece::getPosition)
                    .orElseThrow();
            Color opponent = kingColor == Color.WHITE ? Color.BLACK : Color.WHITE;
            for (Piece piece : board.piecesOf(opponent)) {
                if (piece.getPossibleMoves(board).contains(kingPos)) return true;
            }
            return false;
        }

        Board getBoard() { return board; }
    }

    public static void main(String[] args) {
        Game game = new Game();
        Board board = game.getBoard();

        King whiteKing = new King(Color.WHITE, new Position(7, 4));
        King blackKing = new King(Color.BLACK, new Position(0, 4));
        Knight whiteKnight = new Knight(Color.WHITE, new Position(5, 5));
        board.place(whiteKing);
        board.place(blackKing);
        board.place(whiteKnight);

        System.out.println("Black in check before move: " + game.isInCheck(Color.BLACK));

        // Move the white knight to a square that attacks the black king at (0,4).
        board.move(whiteKnight, new Position(2, 5));
        System.out.println("Black in check after knight move: " + game.isInCheck(Color.BLACK));

        System.out.println("White knight possible moves: " + whiteKnight.getPossibleMoves(board));
    }
}
