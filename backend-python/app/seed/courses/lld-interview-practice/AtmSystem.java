import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Complete reference implementation for the ATM LLD problem: State-driven
 * transaction lifecycle plus a greedy bill-dispensing algorithm.
 *   javac AtmSystem.java && java AtmSystem
 */
public class AtmSystem {

    static class Account {
        private final String accountNumber;
        private double balance;
        private final String pin;

        Account(String accountNumber, double balance, String pin) {
            this.accountNumber = accountNumber;
            this.balance = balance;
            this.pin = pin;
        }

        boolean checkPin(String enteredPin) { return pin.equals(enteredPin); }
        double getBalance() { return balance; }
        void debit(double amount) { balance -= amount; }
    }

    interface BankService {
        Account getAccount(String accountNumber);
    }

    static class InMemoryBankService implements BankService {
        private final Map<String, Account> accounts = new HashMap<>();
        void addAccount(Account account) { accounts.put(account.accountNumber, account); }
        public Account getAccount(String accountNumber) { return accounts.get(accountNumber); }
    }

    static class InsufficientCashException extends RuntimeException {
        InsufficientCashException(String message) { super(message); }
    }

    static class CashDispenser {
        private final Map<Integer, Integer> inventory = new LinkedHashMap<>(); // denomination -> count

        void stock(int denomination, int count) { inventory.merge(denomination, count, Integer::sum); }

        Map<Integer, Integer> dispense(int amount) {
            Map<Integer, Integer> plan = new LinkedHashMap<>();
            int remaining = amount;
            for (Map.Entry<Integer, Integer> entry : inventory.entrySet()) {
                int denomination = entry.getKey();
                int available = entry.getValue();
                int count = Math.min(remaining / denomination, available);
                if (count > 0) {
                    plan.put(denomination, count);
                    remaining -= count * denomination;
                }
            }
            if (remaining != 0) {
                throw new InsufficientCashException("Cannot dispense $" + amount + " with current cash inventory");
            }
            plan.forEach((denomination, count) -> inventory.merge(denomination, -count, Integer::sum));
            return plan;
        }
    }

    interface AtmState {
        void insertCard(Atm atm, String accountNumber);
        void enterPin(Atm atm, String pin);
        void withdraw(Atm atm, double amount);
        String name();
    }

    static class IdleState implements AtmState {
        public void insertCard(Atm atm, String accountNumber) {
            atm.setPendingAccount(accountNumber);
            atm.setState(new HasCardState());
        }
        public void enterPin(Atm atm, String pin) { System.out.println("Insert a card first."); }
        public void withdraw(Atm atm, double amount) { System.out.println("Insert a card first."); }
        public String name() { return "IDLE"; }
    }

    static class HasCardState implements AtmState {
        private int attempts = 0;

        public void insertCard(Atm atm, String accountNumber) { System.out.println("Card already inserted."); }

        public void enterPin(Atm atm, String pin) {
            Account account = atm.getBankService().getAccount(atm.getPendingAccount());
            if (account != null && account.checkPin(pin)) {
                atm.setAuthenticatedAccount(account);
                atm.setState(new AuthenticatedState());
            } else {
                attempts++;
                System.out.println("Incorrect PIN (" + attempts + "/3)");
                if (attempts >= 3) {
                    System.out.println("Too many attempts. Ejecting card.");
                    atm.setState(new IdleState());
                }
            }
        }

        public void withdraw(Atm atm, double amount) { System.out.println("Enter PIN first."); }
        public String name() { return "HAS_CARD"; }
    }

    static class AuthenticatedState implements AtmState {
        public void insertCard(Atm atm, String accountNumber) { System.out.println("Already authenticated."); }
        public void enterPin(Atm atm, String pin) { System.out.println("Already authenticated."); }

        public void withdraw(Atm atm, double amount) {
            Account account = atm.getAuthenticatedAccount();
            if (account.getBalance() < amount) {
                System.out.println("Insufficient funds.");
                return;
            }
            try {
                Map<Integer, Integer> plan = atm.getCashDispenser().dispense((int) amount);
                account.debit(amount);
                System.out.println("Dispensed $" + amount + " as " + plan);
                atm.setState(new IdleState());
            } catch (InsufficientCashException e) {
                System.out.println("ATM cannot dispense that amount: " + e.getMessage());
            }
        }

        public String name() { return "AUTHENTICATED"; }
    }

    static class Atm {
        private AtmState state = new IdleState();
        private final BankService bankService;
        private final CashDispenser cashDispenser = new CashDispenser();
        private String pendingAccount;
        private Account authenticatedAccount;

        Atm(BankService bankService) { this.bankService = bankService; }

        void insertCard(String accountNumber) { state.insertCard(this, accountNumber); }
        void enterPin(String pin) { state.enterPin(this, pin); }
        void withdraw(double amount) { state.withdraw(this, amount); }

        void setState(AtmState state) { this.state = state; }
        void setPendingAccount(String accountNumber) { this.pendingAccount = accountNumber; }
        String getPendingAccount() { return pendingAccount; }
        void setAuthenticatedAccount(Account account) { this.authenticatedAccount = account; }
        Account getAuthenticatedAccount() { return authenticatedAccount; }
        BankService getBankService() { return bankService; }
        CashDispenser getCashDispenser() { return cashDispenser; }
    }

    public static void main(String[] args) {
        InMemoryBankService bank = new InMemoryBankService();
        bank.addAccount(new Account("ACC-1", 500.0, "1234"));

        Atm atm = new Atm(bank);
        atm.getCashDispenser().stock(100, 5);
        atm.getCashDispenser().stock(50, 5);
        atm.getCashDispenser().stock(20, 5);
        atm.getCashDispenser().stock(10, 5);

        atm.insertCard("ACC-1");
        atm.enterPin("0000"); // wrong
        atm.enterPin("1234"); // correct
        atm.withdraw(170);    // dispenses 1x100, 1x50, 1x20
    }
}
