> **Learning goal**
> Turn a request into a standalone object, so it can be queued, logged, undone, or handed to something that has no idea what the request actually does.

## 17.1 The problem: invoker and receiver tightly coupled

A remote control that directly calls methods on the devices it controls has to know every device's concrete API:

```java
class RemoteControl {
    private Light light;
    private Fan fan;

    void pressButton1() { light.turnOn(); }
    void pressButton2() { light.turnOff(); }
    void pressButton3() { fan.start(); }
}
```

Adding a new button for a new device (a `Thermostat`) means editing `RemoteControl` directly, and there's no way to support "undo the last button press" without `RemoteControl` also tracking exactly what kind of action each button performed.

## 17.2 The Command solution

Wrap each request as an object implementing a common `Command` interface with an `execute()` method (and optionally `undo()`); the invoker holds and triggers commands without knowing what they actually do.

```java
interface Command {
    void execute();
    void undo();
}

class Light {
    void turnOn() { System.out.println("Light ON"); }
    void turnOff() { System.out.println("Light OFF"); }
}

class LightOnCommand implements Command {
    private final Light light;
    LightOnCommand(Light light) { this.light = light; }
    public void execute() { light.turnOn(); }
    public void undo() { light.turnOff(); }
}

class RemoteControl {
    private Command lastCommand;

    void pressButton(Command command) {
        command.execute();
        lastCommand = command;
    }

    void pressUndo() {
        if (lastCommand != null) lastCommand.undo();
    }
}
```

```java
Light light = new Light();
RemoteControl remote = new RemoteControl();
remote.pressButton(new LightOnCommand(light));
remote.pressUndo(); // light turns back off — RemoteControl never knew it was controlling a Light
```

`RemoteControl` never references `Light` directly — it only ever talks to `Command`. Adding a `Thermostat` means writing `ThermostatOnCommand` implementing `Command`; `RemoteControl` doesn't change at all.

## 17.3 What Command buys you beyond decoupling

Because a request is now an object instead of a direct method call, you get, almost for free:
- **Undo/redo** — keep a stack of executed commands, pop and call `undo()`.
- **Queuing/scheduling** — commands can sit in a queue and execute later, on a different thread, or in a background job.
- **Logging/replay** — persist executed commands, replay them to reconstruct state (this is the same core idea behind event sourcing and database write-ahead logs).

## 17.4 Command vs. Strategy — another common mix-up

Both wrap "a piece of behavior" behind an interface. Strategy (lesson 14) wraps *how* to do a task that's about to happen right now (`plan(from, to)`), chosen once per call. Command wraps *a specific request*, complete with its own data, meant to potentially be delayed, queued, undone, or logged — the emphasis is on treating the request itself as a first-class object, not just picking which algorithm runs.

## 17.5 Where you'll use this

Undo/redo in a text editor, a job queue processing background `Task` objects, or a `Command`-based macro-recording feature are direct applications. Task scheduling (LLD Practice course, final lesson) leans on exactly this pattern.

> **Review question**
> `RemoteControl` currently supports undoing only the *single* most recent command. Sketch how you'd change it to support unlimited undo/redo history.
