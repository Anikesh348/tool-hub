/**
 * Standalone demo of the Builder pattern: fluent, validated construction
 * of an immutable Pizza instead of a telescoping constructor.
 *   javac BuilderPattern.java && java BuilderPattern
 */
public class BuilderPattern {

    static class Pizza {
        private final String size;
        private final boolean cheese;
        private final boolean pepperoni;
        private final boolean mushrooms;

        private Pizza(Builder builder) {
            this.size = builder.size;
            this.cheese = builder.cheese;
            this.pepperoni = builder.pepperoni;
            this.mushrooms = builder.mushrooms;
        }

        @Override
        public String toString() {
            return size + " pizza [cheese=" + cheese + ", pepperoni=" + pepperoni + ", mushrooms=" + mushrooms + "]";
        }

        static class Builder {
            private final String size; // required
            private boolean cheese = false;
            private boolean pepperoni = false;
            private boolean mushrooms = false;

            Builder(String size) {
                if (size == null || size.isBlank()) throw new IllegalArgumentException("Size is required");
                this.size = size;
            }

            Builder cheese(boolean value) { this.cheese = value; return this; }
            Builder pepperoni(boolean value) { this.pepperoni = value; return this; }
            Builder mushrooms(boolean value) { this.mushrooms = value; return this; }

            Pizza build() {
                if (!cheese && !pepperoni && !mushrooms) {
                    throw new IllegalStateException("Pizza needs at least one topping");
                }
                return new Pizza(this);
            }
        }
    }

    public static void main(String[] args) {
        Pizza pizza = new Pizza.Builder("large")
                .cheese(true)
                .pepperoni(true)
                .build();
        System.out.println(pizza);

        try {
            new Pizza.Builder("small").build(); // no toppings -> rejected at build time
        } catch (IllegalStateException e) {
            System.out.println("Rejected: " + e.getMessage());
        }
    }
}
