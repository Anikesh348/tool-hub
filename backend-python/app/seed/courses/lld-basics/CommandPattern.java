import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Standalone demo of the Command pattern: a RemoteControl that executes
 * and undoes Command objects without knowing what device each one controls.
 *   javac CommandPattern.java && java CommandPattern
 */
public class CommandPattern {

    interface Command {
        void execute();
        void undo();
    }

    static class Light {
        void turnOn() { System.out.println("Light ON"); }
        void turnOff() { System.out.println("Light OFF"); }
    }

    static class Fan {
        void start() { System.out.println("Fan started"); }
        void stop() { System.out.println("Fan stopped"); }
    }

    static class LightOnCommand implements Command {
        private final Light light;
        LightOnCommand(Light light) { this.light = light; }
        public void execute() { light.turnOn(); }
        public void undo() { light.turnOff(); }
    }

    static class FanStartCommand implements Command {
        private final Fan fan;
        FanStartCommand(Fan fan) { this.fan = fan; }
        public void execute() { fan.start(); }
        public void undo() { fan.stop(); }
    }

    static class RemoteControl {
        private final Deque<Command> history = new ArrayDeque<>();

        void pressButton(Command command) {
            command.execute();
            history.push(command);
        }

        void pressUndo() {
            if (!history.isEmpty()) {
                history.pop().undo();
            }
        }
    }

    public static void main(String[] args) {
        Light light = new Light();
        Fan fan = new Fan();
        RemoteControl remote = new RemoteControl();

        remote.pressButton(new LightOnCommand(light));
        remote.pressButton(new FanStartCommand(fan));

        remote.pressUndo(); // undoes the fan (most recent)
        remote.pressUndo(); // undoes the light
    }
}
