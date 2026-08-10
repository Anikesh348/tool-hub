import java.util.ArrayList;
import java.util.List;

/**
 * Standalone demo of association, aggregation, and composition using
 * Teacher/Course (association), Library/Book (aggregation), and
 * House/Room (composition).
 *   javac Relationships.java && java Relationships
 */
public class Relationships {

    // --- Association: neither side owns the other, both have independent lifetimes ---
    static class Teacher {
        private final String name;
        Teacher(String name) { this.name = name; }
        String getName() { return name; }
    }

    static class Course {
        private final String title;
        private Teacher teacher; // just a reference, can be reassigned freely

        Course(String title) { this.title = title; }
        void assignTeacher(Teacher teacher) { this.teacher = teacher; }
        String describe() { return title + " taught by " + (teacher != null ? teacher.getName() : "TBD"); }
    }

    // --- Aggregation: Library holds Books, but Books are passed in and outlive it ---
    static class Book {
        private final String isbn;
        Book(String isbn) { this.isbn = isbn; }
        String getIsbn() { return isbn; }
    }

    static class Library {
        private final List<Book> books = new ArrayList<>();
        void addBook(Book book) { books.add(book); } // Library never constructs a Book itself
        int bookCount() { return books.size(); }
    }

    // --- Composition: House creates and owns its Rooms; they have no independent existence ---
    static class Room {
        private final double areaSqm;
        Room(double areaSqm) { this.areaSqm = areaSqm; }
        double getArea() { return areaSqm; }
    }

    static class House {
        private final List<Room> rooms = new ArrayList<>();

        House(int roomCount, double areaPerRoom) {
            for (int i = 0; i < roomCount; i++) {
                rooms.add(new Room(areaPerRoom)); // created internally, owned for life
            }
        }

        double totalArea() {
            return rooms.stream().mapToDouble(Room::getArea).sum();
        }
    }

    public static void main(String[] args) {
        // Association
        Teacher teacher = new Teacher("Dr. Rao");
        Course course = new Course("Distributed Systems");
        course.assignTeacher(teacher);
        System.out.println(course.describe());

        // Aggregation
        Library library = new Library();
        Book existingBook = new Book("978-0132350884"); // constructed independently
        library.addBook(existingBook);
        System.out.println("Library has " + library.bookCount() + " book(s); the Book still exists on its own.");

        // Composition
        House house = new House(3, 20.0); // Rooms are created inside House's constructor
        System.out.println("House total area: " + house.totalArea() + " sqm");
    }
}
