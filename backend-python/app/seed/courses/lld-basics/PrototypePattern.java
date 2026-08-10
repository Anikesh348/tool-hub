import java.util.ArrayList;
import java.util.List;

/**
 * Standalone demo of the Prototype pattern, including the shallow-vs-deep
 * copy trap: cloning by copying an existing instance instead of rebuilding
 * from scratch.
 *   javac PrototypePattern.java && java PrototypePattern
 */
public class PrototypePattern {

    interface Prototype<T> {
        T deepClone();
    }

    static class GameCharacter implements Prototype<GameCharacter> {
        private final String name;
        private final int health;
        private final List<String> abilities;

        GameCharacter(String name, int health, List<String> abilities) {
            this.name = name;
            this.health = health;
            this.abilities = new ArrayList<>(abilities); // own copy at construction time too
        }

        @Override
        public GameCharacter deepClone() {
            return new GameCharacter(this.name, this.health, this.abilities); // deep-copies the list
        }

        // Shown only to demonstrate the bug a shallow clone would introduce.
        GameCharacter shallowCloneBug() {
            GameCharacter copy = new GameCharacter(this.name, this.health, List.of());
            copy.abilities.clear();
            copy.abilities.addAll(this.abilities); // still a separate call, so this demo stays safe;
            return copy;                            // see the README-style commentary in the .md lesson.
        }

        List<String> getAbilities() { return abilities; }

        @Override
        public String toString() {
            return name + " [hp=" + health + ", abilities=" + abilities + "]";
        }
    }

    public static void main(String[] args) {
        GameCharacter template = new GameCharacter("Orc Warrior", 100, List.of("Slam", "Roar"));

        GameCharacter enemy1 = template.deepClone();
        GameCharacter enemy2 = template.deepClone();

        enemy1.getAbilities().add("Poison"); // mutate one clone

        System.out.println("template: " + template);
        System.out.println("enemy1:   " + enemy1);
        System.out.println("enemy2:   " + enemy2);
        // template and enemy2 are unaffected by enemy1's mutation because deepClone()
        // gave each character its own independent abilities list.
    }
}
