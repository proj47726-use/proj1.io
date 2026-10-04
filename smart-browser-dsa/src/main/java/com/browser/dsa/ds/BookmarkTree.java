package com.browser.dsa.ds;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.Predicate;

/**
 * N-ary tree for bookmarks.
 * Folders hold folders and links. Search is iterative depth-first (O(n)).
 * Root cannot be removed. Matches engine.js BookmarkTree.
 */
public class BookmarkTree {

    public static class BookmarkNode {
        private final int id;
        private final String name;
        private final boolean isFolder;
        private final String url;   // null for folders
        private final List<BookmarkNode> children = new ArrayList<>();

        public BookmarkNode(int id, String name, boolean isFolder, String url) {
            this.id = id;
            this.name = name;
            this.isFolder = isFolder;
            this.url = url;
        }

        public int getId() { return id; }
        public String getName() { return name; }
        public boolean isFolder() { return isFolder; }
        public String getUrl() { return url; }
        public List<BookmarkNode> getChildren() { return children; }
    }

    private int nextId = 1;
    private final BookmarkNode root = new BookmarkNode(0, "Bookmarks", true, null);
    private BookmarkNode favorites;

    public BookmarkTree() {
        favorites = addFolder(0, "Favorites");
    }

    public BookmarkNode getRoot() { return root; }
    public BookmarkNode getFavorites() { return favorites; }

    /** Depth-first search. O(n). Returns the node or null. */
    public synchronized BookmarkNode find(int id) {
        return findInternal(n -> n.getId() == id);
    }

    public synchronized BookmarkNode findByUrl(String url) {
        return findInternal(n -> !n.isFolder() && Objects.equals(n.getUrl(), url));
    }

    private BookmarkNode findInternal(Predicate<BookmarkNode> pred) {
        // Iterative DFS so deep trees never blow the call stack
        List<BookmarkNode> stack = new ArrayList<>();
        stack.add(root);
        while (!stack.isEmpty()) {
            BookmarkNode n = stack.remove(stack.size() - 1);
            if (pred.test(n)) {
                return n;
            }
            // push children in reverse so left-to-right order is preserved
            for (int i = n.getChildren().size() - 1; i >= 0; i--) {
                stack.add(n.getChildren().get(i));
            }
        }
        return null;
    }

    private BookmarkNode findParent(int id) {
        List<BookmarkNode> stack = new ArrayList<>();
        stack.add(root);
        while (!stack.isEmpty()) {
            BookmarkNode n = stack.remove(stack.size() - 1);
            for (BookmarkNode child : n.getChildren()) {
                if (child.getId() == id) {
                    return n;
                }
                if (child.isFolder()) {
                    stack.add(child);
                }
            }
        }
        return null;
    }

    /** O(n) to locate parent, O(1) to attach. Returns the new node or null. */
    public synchronized BookmarkNode addFolder(int parentId, String name) {
        BookmarkNode parent = find(parentId);
        if (parent == null || !parent.isFolder()) {
            return null;
        }
        BookmarkNode node = new BookmarkNode(nextId++, name, true, null);
        parent.getChildren().add(node);
        return node;
    }

    /**
     * Returns the new node, or null if parent is invalid or the URL is already bookmarked.
     */
    public synchronized BookmarkNode addBookmark(int parentId, String name, String url) {
        BookmarkNode parent = find(parentId);
        if (parent == null || !parent.isFolder() || findByUrl(url) != null) {
            return null;
        }
        BookmarkNode node = new BookmarkNode(nextId++, name, false, url);
        parent.getChildren().add(node);
        return node;
    }

    /** Removes a node and its whole subtree. Root cannot be removed. O(n). */
    public synchronized boolean remove(int id) {
        if (id == root.getId()) {
            return false;
        }
        BookmarkNode parent = findParent(id);
        if (parent == null) {
            return false;
        }
        return parent.getChildren().removeIf(c -> c.getId() == id);
    }

    /** Number of links only (folders are not counted). */
    public synchronized int countBookmarks() {
        int[] total = {0};
        walk(root, n -> {
            if (!n.isFolder()) {
                total[0]++;
            }
        });
        return total[0];
    }

    private void walk(BookmarkNode n, Consumer<BookmarkNode> action) {
        action.accept(n);
        for (BookmarkNode c : n.getChildren()) {
            walk(c, action);
        }
    }
}
