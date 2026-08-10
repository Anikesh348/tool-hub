import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Complete reference implementation for the Library Management System LLD
 * problem: Book/BookCopy split, Checkout as a first-class entity, and a
 * pluggable fine-calculation strategy.
 *   javac LibrarySystem.java && java LibrarySystem
 */
public class LibrarySystem {

    static class Book {
        private final String isbn;
        private final String title;
        private final String author;
        private final List<BookCopy> copies = new ArrayList<>();

        Book(String isbn, String title, String author) {
            this.isbn = isbn;
            this.title = title;
            this.author = author;
        }

        void addCopy(BookCopy copy) { copies.add(copy); }
        Optional<BookCopy> findAvailableCopy() {
            return copies.stream().filter(BookCopy::isAvailable).findFirst();
        }

        String getTitle() { return title; }
        String getIsbn() { return isbn; }
    }

    static class BookCopy {
        private final String copyId;
        private boolean available = true;

        BookCopy(String copyId) { this.copyId = copyId; }

        boolean isAvailable() { return available; }
        void markUnavailable() { available = false; }
        void markAvailable() { available = true; }
        String getCopyId() { return copyId; }
    }

    static class Member {
        private final String memberId;
        private final String name;
        private final List<Checkout> history = new ArrayList<>();

        Member(String memberId, String name) {
            this.memberId = memberId;
            this.name = name;
        }

        void addCheckout(Checkout checkout) { history.add(checkout); }

        long overdueCount(LocalDate today) {
            return history.stream()
                    .filter(c -> c.getReturnedDate() == null && c.getDueDate().isBefore(today))
                    .count();
        }

        String getName() { return name; }
    }

    static class Checkout {
        private final BookCopy copy;
        private final Member member;
        private final LocalDate checkoutDate;
        private final LocalDate dueDate;
        private LocalDate returnedDate;

        Checkout(BookCopy copy, Member member, LocalDate checkoutDate, LocalDate dueDate) {
            this.copy = copy;
            this.member = member;
            this.checkoutDate = checkoutDate;
            this.dueDate = dueDate;
        }

        BookCopy getCopy() { return copy; }
        LocalDate getDueDate() { return dueDate; }
        LocalDate getReturnedDate() { return returnedDate; }
        void markReturned(LocalDate date) { this.returnedDate = date; }
    }

    interface FineCalculator {
        double calculate(Checkout checkout, LocalDate returnDate);
    }

    static class DailyRateFineCalculator implements FineCalculator {
        private final double ratePerDay;
        DailyRateFineCalculator(double ratePerDay) { this.ratePerDay = ratePerDay; }

        public double calculate(Checkout checkout, LocalDate returnDate) {
            long overdueDays = ChronoUnit.DAYS.between(checkout.getDueDate(), returnDate);
            return overdueDays > 0 ? overdueDays * ratePerDay : 0;
        }
    }

    static class Library {
        private final List<Book> catalog = new ArrayList<>();
        private final List<Checkout> activeCheckouts = new ArrayList<>();
        private final FineCalculator fineCalculator;

        Library(FineCalculator fineCalculator) { this.fineCalculator = fineCalculator; }

        void addBook(Book book) { catalog.add(book); }

        Optional<Checkout> checkout(String isbn, Member member, LocalDate today) {
            return catalog.stream()
                    .filter(b -> b.getIsbn().equals(isbn))
                    .findFirst()
                    .flatMap(Book::findAvailableCopy)
                    .map(copy -> {
                        copy.markUnavailable();
                        Checkout checkout = new Checkout(copy, member, today, today.plusDays(14));
                        activeCheckouts.add(checkout);
                        member.addCheckout(checkout);
                        return checkout;
                    });
        }

        double returnBook(String copyId, LocalDate today) {
            Checkout checkout = activeCheckouts.stream()
                    .filter(c -> c.getCopy().getCopyId().equals(copyId) && c.getReturnedDate() == null)
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("No active checkout for copy " + copyId));
            checkout.getCopy().markAvailable();
            checkout.markReturned(today);
            return fineCalculator.calculate(checkout, today);
        }
    }

    public static void main(String[] args) {
        Library library = new Library(new DailyRateFineCalculator(0.50));

        Book cleanCode = new Book("978-0132350884", "Clean Code", "Robert C. Martin");
        cleanCode.addCopy(new BookCopy("CC-1"));
        cleanCode.addCopy(new BookCopy("CC-2"));
        library.addBook(cleanCode);

        Member alice = new Member("M-1", "Alice");

        Optional<Checkout> checkout = library.checkout("978-0132350884", alice, LocalDate.of(2026, 1, 1));
        checkout.ifPresent(c -> System.out.println("Checked out " + c.getCopy().getCopyId() + ", due " + c.getDueDate()));

        double fine = library.returnBook("CC-1", LocalDate.of(2026, 1, 20)); // 6 days overdue
        System.out.println("Fine charged: $" + fine);
    }
}
