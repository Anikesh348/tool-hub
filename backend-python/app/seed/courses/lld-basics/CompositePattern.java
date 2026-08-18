import java.util.ArrayList;
import java.util.List;

/**
 * Standalone demo of the Composite pattern: files and folders share one
 * interface so a folder's size() is just "sum the children," recursively.
 *   javac CompositePattern.java && java CompositePattern
 */
public class CompositePattern {

    interface FileSystemNode {
        long size();
        void print(String indent);
    }

    static class FileNode implements FileSystemNode {
        private final String name;
        private final long sizeInBytes;

        FileNode(String name, long sizeInBytes) {
            this.name = name;
            this.sizeInBytes = sizeInBytes;
        }

        @Override
        public long size() { return sizeInBytes; }

        @Override
        public void print(String indent) {
            System.out.println(indent + "- " + name + " (" + sizeInBytes + " bytes)");
        }
    }

    static class FolderNode implements FileSystemNode {
        private final String name;
        private final List<FileSystemNode> children = new ArrayList<>();

        FolderNode(String name) { this.name = name; }

        void add(FileSystemNode child) { children.add(child); }

        @Override
        public long size() {
            long total = 0;
            for (FileSystemNode child : children) {
                total += child.size();
            }
            return total;
        }

        @Override
        public void print(String indent) {
            System.out.println(indent + "+ " + name + "/");
            for (FileSystemNode child : children) {
                child.print(indent + "  ");
            }
        }
    }

    public static void main(String[] args) {
        FolderNode root = new FolderNode("root");
        root.add(new FileNode("readme.txt", 1000));

        FolderNode subfolder = new FolderNode("photos");
        subfolder.add(new FileNode("a.jpg", 2000));
        subfolder.add(new FileNode("b.jpg", 500));
        root.add(subfolder);

        root.print("");
        System.out.println("Total size: " + root.size() + " bytes");
    }
}
