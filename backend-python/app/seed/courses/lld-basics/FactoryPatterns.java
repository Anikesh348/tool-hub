/**
 * Standalone demo of Factory Method (ShapeFactory) and Abstract Factory
 * (UiFactory guaranteeing a consistent widget family).
 *   javac FactoryPatterns.java && java FactoryPatterns
 */
public class FactoryPatterns {

    // --- Factory Method ---
    interface Shape { double area(); }

    static class Circle implements Shape {
        private final double radius;
        Circle(double radius) { this.radius = radius; }
        public double area() { return Math.PI * radius * radius; }
    }

    static class Square implements Shape {
        private final double side;
        Square(double side) { this.side = side; }
        public double area() { return side * side; }
    }

    static class ShapeFactory {
        static Shape create(String type, double size) {
            return switch (type) {
                case "circle" -> new Circle(size);
                case "square" -> new Square(size);
                default -> throw new IllegalArgumentException("Unknown type: " + type);
            };
        }
    }

    // --- Abstract Factory ---
    interface Button { void render(); }
    interface Checkbox { void render(); }

    static class WindowsButton implements Button { public void render() { System.out.println("Windows button"); } }
    static class WindowsCheckbox implements Checkbox { public void render() { System.out.println("Windows checkbox"); } }
    static class MacButton implements Button { public void render() { System.out.println("Mac button"); } }
    static class MacCheckbox implements Checkbox { public void render() { System.out.println("Mac checkbox"); } }

    interface UiFactory {
        Button createButton();
        Checkbox createCheckbox();
    }

    static class WindowsUiFactory implements UiFactory {
        public Button createButton() { return new WindowsButton(); }
        public Checkbox createCheckbox() { return new WindowsCheckbox(); }
    }

    static class MacUiFactory implements UiFactory {
        public Button createButton() { return new MacButton(); }
        public Checkbox createCheckbox() { return new MacCheckbox(); }
    }

    static void renderUi(UiFactory factory) {
        factory.createButton().render();
        factory.createCheckbox().render();
    }

    public static void main(String[] args) {
        Shape circle = ShapeFactory.create("circle", 3);
        Shape square = ShapeFactory.create("square", 4);
        System.out.println("Circle area: " + circle.area());
        System.out.println("Square area: " + square.area());

        String os = "mac"; // pretend this came from runtime detection
        UiFactory uiFactory = os.equals("mac") ? new MacUiFactory() : new WindowsUiFactory();
        renderUi(uiFactory); // every widget produced is guaranteed to match the chosen OS
    }
}
