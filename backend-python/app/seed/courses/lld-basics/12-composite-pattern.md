> **Learning goal**
> Treat individual objects and groups of objects through the exact same interface, so client code doesn't need to know or care whether it's holding a single item or a whole tree of them.

## 12.1 The problem: files and folders need different handling

A filesystem viewer needs to compute the total size of a folder, which contains both files and other folders:

```java
class File {
    long size;
}

class Folder {
    List<File> files;
    List<Folder> subfolders;
}
```

Computing total size means writing separate, parallel logic for "is this a `File`?" versus "is this a `Folder`?" everywhere the tree is traversed — and that logic has to be duplicated (or carefully shared) at every level of nesting.

## 12.2 The Composite solution

Give both the individual object ("leaf") and the group ("composite") the same interface, so a composite's operation is just "ask each child to do the same operation, and combine the results."

```java
interface FileSystemNode {
    long size();
}

class FileNode implements FileSystemNode {
    private final long sizeInBytes;
    FileNode(long sizeInBytes) { this.sizeInBytes = sizeInBytes; }
    public long size() { return sizeInBytes; }
}

class FolderNode implements FileSystemNode {
    private final List<FileSystemNode> children = new ArrayList<>();

    void add(FileSystemNode child) { children.add(child); }

    @Override
    public long size() {
        long total = 0;
        for (FileSystemNode child : children) {
            total += child.size(); // works whether child is a FileNode or another FolderNode
        }
        return total;
    }
}
```

```java
FolderNode root = new FolderNode();
root.add(new FileNode(1000));
FolderNode subfolder = new FolderNode();
subfolder.add(new FileNode(2000));
subfolder.add(new FileNode(500));
root.add(subfolder);

System.out.println(root.size()); // 3500 — no special-casing needed for the nested folder
```

Client code calling `root.size()` never needs to know how deep the tree goes, or whether any given child is a leaf or another composite — that's the entire point of the pattern. `FolderNode.size()` doesn't even know it's dealing with a mix of files and subfolders; it just trusts every `FileSystemNode` to answer `size()` correctly.

## 12.3 Composite vs. plain recursion over two types

You *could* get the same recursive behavior with `instanceof` checks and no shared interface — but every operation (`size()`, `delete()`, `search()`, `print()`) would need its own recursive function with its own `instanceof` branching, and adding a third node type (e.g. a symbolic link) means updating every one of those functions. Composite pays a small upfront cost (a shared interface) to make every future operation and every future node type a one-line addition.

## 12.4 Where you'll use this

Composite shows up whenever an LLD problem has a naturally recursive/tree-shaped domain: a filesystem, an org chart (employee vs. manager-with-reports), a UI component tree (a `Button` vs. a `Panel` containing other components), or nested menu categories in a restaurant-ordering system. Any time you catch yourself writing `if (isLeaf) ... else if (isGroup) ...` recursively, Composite is worth considering.

> **Review question**
> Add a `delete()` operation to `FileSystemNode`. What does `FolderNode.delete()` need to do differently from `FileNode.delete()`, and does the client code calling `delete()` need to know which one it's calling?
