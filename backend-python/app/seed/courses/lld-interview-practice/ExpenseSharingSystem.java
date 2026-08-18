import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;

/**
 * Complete reference implementation for the Splitwise-style Expense
 * Sharing LLD problem: pluggable split strategies, a net-balance ledger,
 * and a greedy minimal-transaction settlement algorithm.
 *   javac ExpenseSharingSystem.java && java ExpenseSharingSystem
 */
public class ExpenseSharingSystem {

    static class User {
        private final String name;
        User(String name) { this.name = name; }
        String getName() { return name; }
        @Override public String toString() { return name; }
    }

    interface SplitStrategy {
        Map<User, Long> split(long totalAmountCents, List<User> participants);
    }

    static class EqualSplit implements SplitStrategy {
        public Map<User, Long> split(long totalAmountCents, List<User> participants) {
            long share = totalAmountCents / participants.size();
            long remainder = totalAmountCents - share * participants.size();
            Map<User, Long> result = new LinkedHashMap<>();
            for (int i = 0; i < participants.size(); i++) {
                result.put(participants.get(i), share + (i < remainder ? 1 : 0));
            }
            return result;
        }
    }

    static class Ledger {
        private final Map<User, Long> netBalanceCents = new LinkedHashMap<>(); // positive = owed money

        void recordExpense(User payer, Map<User, Long> shares) {
            for (Map.Entry<User, Long> entry : shares.entrySet()) {
                User participant = entry.getKey();
                long share = entry.getValue();
                if (participant == payer) continue;
                netBalanceCents.merge(participant, -share, Long::sum); // participant owes their share
                netBalanceCents.merge(payer, share, Long::sum);        // payer is owed that share
            }
        }

        Map<User, Long> getNetBalances() { return netBalanceCents; }
    }

    record Payment(User from, User to, long amountCents) {}

    static class SettlementCalculator {
        List<Payment> simplify(Map<User, Long> netBalances) {
            PriorityQueue<Map.Entry<User, Long>> creditors =
                    new PriorityQueue<>((a, b) -> Long.compare(b.getValue(), a.getValue()));
            PriorityQueue<Map.Entry<User, Long>> debtors =
                    new PriorityQueue<>((a, b) -> Long.compare(a.getValue(), b.getValue()));

            for (Map.Entry<User, Long> entry : netBalances.entrySet()) {
                if (entry.getValue() > 0) creditors.add(new LinkedHashMap.SimpleEntry<>(entry.getKey(), entry.getValue()));
                else if (entry.getValue() < 0) debtors.add(new LinkedHashMap.SimpleEntry<>(entry.getKey(), entry.getValue()));
            }

            List<Payment> payments = new ArrayList<>();
            while (!creditors.isEmpty() && !debtors.isEmpty()) {
                Map.Entry<User, Long> creditor = creditors.poll();
                Map.Entry<User, Long> debtor = debtors.poll();
                long amount = Math.min(creditor.getValue(), -debtor.getValue());

                payments.add(new Payment(debtor.getKey(), creditor.getKey(), amount));

                long remainingCredit = creditor.getValue() - amount;
                long remainingDebt = debtor.getValue() + amount;
                if (remainingCredit > 0) creditors.add(new LinkedHashMap.SimpleEntry<>(creditor.getKey(), remainingCredit));
                if (remainingDebt < 0) debtors.add(new LinkedHashMap.SimpleEntry<>(debtor.getKey(), remainingDebt));
            }
            return payments;
        }
    }

    public static void main(String[] args) {
        User alice = new User("Alice");
        User bob = new User("Bob");
        User carol = new User("Carol");

        Ledger ledger = new Ledger();
        SplitStrategy equalSplit = new EqualSplit();

        // Alice pays $30 for dinner, split equally among all three.
        ledger.recordExpense(alice, equalSplit.split(3000, List.of(alice, bob, carol)));

        // Bob pays $15 for a taxi, split equally between Bob and Carol.
        ledger.recordExpense(bob, equalSplit.split(1500, List.of(bob, carol)));

        System.out.println("Net balances (cents): " + ledger.getNetBalances());

        SettlementCalculator calculator = new SettlementCalculator();
        List<Payment> payments = calculator.simplify(ledger.getNetBalances());

        System.out.println("Settlement plan:");
        for (Payment p : payments) {
            System.out.println("  " + p.from() + " pays " + p.to() + " $" + (p.amountCents() / 100.0));
        }
    }
}
