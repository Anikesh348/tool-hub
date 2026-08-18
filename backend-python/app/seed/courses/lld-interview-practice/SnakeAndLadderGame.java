import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Complete reference implementation for the Snake and Ladder LLD problem:
 * snakes/ladders unified as one Jump concept, no-overshoot rule, single-jump
 * resolution per landing.
 *   javac SnakeAndLadderGame.java && java SnakeAndLadderGame
 */
public class SnakeAndLadderGame {

    record Jump(int start, int end) {}

    static class Board {
        private final int size;
        private final Map<Integer, Integer> jumps;

        Board(int size, List<Jump> jumps) {
            this.size = size;
            this.jumps = new HashMap<>();
            for (Jump j : jumps) this.jumps.put(j.start(), j.end());
        }

        int resolveLanding(int cell) {
            return jumps.getOrDefault(cell, cell);
        }

        int getSize() { return size; }
    }

    static class Player {
        private final String name;
        private int position = 0;

        Player(String name) { this.name = name; }
        String getName() { return name; }
        int getPosition() { return position; }
        void setPosition(int position) { this.position = position; }
    }

    static class Dice {
        private final Random random = new Random();
        private final int sides;

        Dice(int sides) { this.sides = sides; }
        int roll() { return random.nextInt(sides) + 1; }
    }

    static class Game {
        private final Board board;
        private final List<Player> players;
        private final Dice dice;

        Game(Board board, List<Player> players, Dice dice) {
            this.board = board;
            this.players = players;
            this.dice = dice;
        }

        Player play(long maxTurns) {
            int turnIndex = 0;
            for (long turn = 0; turn < maxTurns; turn++) {
                Player current = players.get(turnIndex % players.size());
                int roll = dice.roll();
                int target = current.getPosition() + roll;

                if (target > board.getSize()) {
                    System.out.println(current.getName() + " rolled " + roll + ", overshoots - turn skipped.");
                } else {
                    int landedCell = board.resolveLanding(target);
                    if (landedCell != target) {
                        System.out.println(current.getName() + " rolled " + roll + ", moved to " + target
                                + ", jumped to " + landedCell);
                    } else {
                        System.out.println(current.getName() + " rolled " + roll + ", moved to " + target);
                    }
                    current.setPosition(landedCell);
                    if (landedCell == board.getSize()) {
                        return current;
                    }
                }
                turnIndex++;
            }
            return null; // no winner within maxTurns
        }
    }

    public static void main(String[] args) {
        List<Jump> jumps = new ArrayList<>();
        jumps.add(new Jump(16, 6));   // snake
        jumps.add(new Jump(48, 26));  // snake
        jumps.add(new Jump(2, 38));   // ladder
        jumps.add(new Jump(20, 41));  // ladder

        Board board = new Board(100, jumps);
        List<Player> players = List.of(new Player("Alice"), new Player("Bob"));
        Game game = new Game(board, players, new Dice(6));

        Player winner = game.play(500);
        System.out.println(winner != null ? winner.getName() + " wins!" : "No winner within turn limit.");
    }
}
