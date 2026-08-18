/**
 * Standalone demo of Template Method (DataImporter, fixed steps + a
 * varying parse step) and Chain of Responsibility (Approver chain).
 *   javac TemplateMethodAndChainOfResponsibility.java && java TemplateMethodAndChainOfResponsibility
 */
public class TemplateMethodAndChainOfResponsibility {

    // --- Template Method ---
    abstract static class DataImporter {
        final void importData(String path) {
            String raw = readFile(path);
            Object parsed = parse(raw);
            validate(parsed);
            save(parsed);
        }

        private String readFile(String path) {
            System.out.println("Reading " + path);
            return "raw-content-of-" + path;
        }

        abstract Object parse(String raw);

        private void validate(Object data) {
            System.out.println("Validating parsed data");
        }

        private void save(Object data) {
            System.out.println("Saving parsed data");
        }
    }

    static class CsvImporter extends DataImporter {
        Object parse(String raw) {
            System.out.println("Parsing as CSV");
            return raw.split(",");
        }
    }

    static class JsonImporter extends DataImporter {
        Object parse(String raw) {
            System.out.println("Parsing as JSON");
            return raw;
        }
    }

    // --- Chain of Responsibility ---
    abstract static class Approver {
        protected Approver next;

        void setNext(Approver next) { this.next = next; }

        void approve(double amount) {
            if (canApprove(amount)) {
                System.out.println(getClass().getSimpleName() + " approved $" + amount);
            } else if (next != null) {
                next.approve(amount);
            } else {
                System.out.println("No one could approve $" + amount);
            }
        }

        abstract boolean canApprove(double amount);
    }

    static class Manager extends Approver {
        boolean canApprove(double amount) { return amount <= 1000; }
    }

    static class Director extends Approver {
        boolean canApprove(double amount) { return amount <= 10000; }
    }

    static class Vp extends Approver {
        boolean canApprove(double amount) { return amount <= 100000; }
    }

    public static void main(String[] args) {
        System.out.println("--- Template Method ---");
        new CsvImporter().importData("data.csv");
        new JsonImporter().importData("data.json");

        System.out.println("\n--- Chain of Responsibility ---");
        Approver manager = new Manager();
        Approver director = new Director();
        Approver vp = new Vp();
        manager.setNext(director);
        director.setNext(vp);

        manager.approve(500);
        manager.approve(5000);
        manager.approve(50000);
        manager.approve(500000); // exceeds every handler's limit
    }
}
