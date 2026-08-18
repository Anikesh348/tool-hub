/**
 * Standalone demo of the Decorator pattern: stackable coffee add-ons
 * without a combinatorial explosion of subclasses.
 *   javac DecoratorPattern.java && java DecoratorPattern
 */
public class DecoratorPattern {

    interface Coffee {
        double cost();
        String description();
    }

    static class SimpleCoffee implements Coffee {
        public double cost() { return 2.0; }
        public String description() { return "Coffee"; }
    }

    abstract static class CoffeeDecorator implements Coffee {
        protected final Coffee wrapped;
        CoffeeDecorator(Coffee wrapped) { this.wrapped = wrapped; }
    }

    static class MilkDecorator extends CoffeeDecorator {
        MilkDecorator(Coffee wrapped) { super(wrapped); }
        public double cost() { return wrapped.cost() + 0.5; }
        public String description() { return wrapped.description() + " + Milk"; }
    }

    static class SugarDecorator extends CoffeeDecorator {
        SugarDecorator(Coffee wrapped) { super(wrapped); }
        public double cost() { return wrapped.cost() + 0.25; }
        public String description() { return wrapped.description() + " + Sugar"; }
    }

    static class WhippedCreamDecorator extends CoffeeDecorator {
        WhippedCreamDecorator(Coffee wrapped) { super(wrapped); }
        public double cost() { return wrapped.cost() + 0.75; }
        public String description() { return wrapped.description() + " + Whipped Cream"; }
    }

    public static void main(String[] args) {
        Coffee plain = new SimpleCoffee();
        System.out.println(plain.description() + " = $" + plain.cost());

        Coffee milkSugar = new SugarDecorator(new MilkDecorator(new SimpleCoffee()));
        System.out.println(milkSugar.description() + " = $" + milkSugar.cost());

        Coffee everything = new WhippedCreamDecorator(new SugarDecorator(new MilkDecorator(new SimpleCoffee())));
        System.out.println(everything.description() + " = $" + everything.cost());
    }
}
