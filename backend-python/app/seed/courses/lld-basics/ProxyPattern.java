/**
 * Standalone demo of the Proxy pattern: a virtual proxy that defers
 * expensive image loading, and a protection proxy that checks permissions
 * before delegating.
 *   javac ProxyPattern.java && java ProxyPattern
 */
public class ProxyPattern {

    interface Image {
        void display();
    }

    static class RealImage implements Image {
        private final String filename;

        RealImage(String filename) {
            this.filename = filename;
            loadFromDisk();
        }

        private void loadFromDisk() {
            System.out.println("Loading " + filename + " from disk (expensive)");
        }

        @Override
        public void display() {
            System.out.println("Displaying " + filename);
        }
    }

    static class ImageProxy implements Image {
        private final String filename;
        private RealImage real;

        ImageProxy(String filename) { this.filename = filename; }

        @Override
        public void display() {
            if (real == null) {
                real = new RealImage(filename); // only loads on first actual display
            }
            real.display();
        }
    }

    interface AdminPanel {
        void deleteUser(String userId);
    }

    static class RealAdminPanel implements AdminPanel {
        @Override
        public void deleteUser(String userId) {
            System.out.println("Deleted user " + userId);
        }
    }

    static class AdminPanelProtectionProxy implements AdminPanel {
        private final RealAdminPanel real = new RealAdminPanel();
        private final String currentUserRole;

        AdminPanelProtectionProxy(String currentUserRole) {
            this.currentUserRole = currentUserRole;
        }

        @Override
        public void deleteUser(String userId) {
            if (!"ADMIN".equals(currentUserRole)) {
                throw new SecurityException("Only admins can delete users");
            }
            real.deleteUser(userId);
        }
    }

    public static void main(String[] args) {
        System.out.println("--- Virtual proxy ---");
        Image[] gallery = { new ImageProxy("a.jpg"), new ImageProxy("b.jpg") };
        System.out.println("Gallery created, nothing loaded yet.");
        gallery[0].display(); // only now does a.jpg actually load

        System.out.println("\n--- Protection proxy ---");
        AdminPanel viewerPanel = new AdminPanelProtectionProxy("VIEWER");
        AdminPanel adminPanel = new AdminPanelProtectionProxy("ADMIN");
        try {
            viewerPanel.deleteUser("user-1");
        } catch (SecurityException e) {
            System.out.println("Blocked: " + e.getMessage());
        }
        adminPanel.deleteUser("user-1");
    }
}
