package com.browser.dsa.ds;

import com.browser.dsa.model.HistoryNode;
import com.browser.dsa.model.HistorySnapshot;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Browser history as a doubly linked list.
 *
 *   HEAD -> [a] <-> [b] <-> [c] <-> [d]
 *                          ^
 *                       current   (position = 3, size = 4)
 *
 * We keep a running {@code position} (where current sits) and {@code size}.
 * That is what makes visit() truly O(1): the number of pages being discarded
 * is simply size - position, so we never have to walk the forward pages.
 * Cutting them off is one pointer change; Java's garbage collector reclaims
 * the orphaned nodes.
 */
public class CustomDoublyLinkedList {
    private HistoryNode head;
    private HistoryNode current;
    private int size;
    private int position;

    /** Open a new page after the current one, discarding any forward history. O(1). */
    public synchronized HistoryNode visit(String url) {
        HistoryNode newNode = new HistoryNode(url);
        if (head == null) {
            head = newNode;
            current = newNode;
            position = 1;
        } else {
            current.setNext(newNode);   // this single line cuts off the old forward pages
            newNode.setPrev(current);
            current = newNode;
            position++;
        }
        size = position;                // everything after current is gone
        return current;
    }

    /** Move one page back. Does nothing at the first page. O(1). */
    public synchronized HistoryNode back() {
        if (current != null && current.getPrev() != null) {
            current = current.getPrev();
            position--;
        }
        return current;
    }

    /** Move one page forward. Does nothing at the last page. O(1). */
    public synchronized HistoryNode forward() {
        if (current != null && current.getNext() != null) {
            current = current.getNext();
            position++;
        }
        return current;
    }

    /**
     * Jump straight to the page at a 1-based index.
     * Walks one node at a time, so it costs O(k) where k is the distance travelled.
     * Returns null (and changes nothing) if the index is out of range.
     */
    public synchronized HistoryNode jumpTo(int index) {
        if (index < 1 || index > size) return null;
        while (position > index) { current = current.getPrev(); position--; }
        while (position < index) { current = current.getNext(); position++; }
        return current;
    }

    /** Forget all history. O(1): just drop the head pointer. */
    public synchronized void clear() {
        head = null;
        current = null;
        size = 0;
        position = 0;
    }

    /** A consistent copy of the list's state. O(n) because it lists every URL. */
    public synchronized HistorySnapshot snapshot() {
        List<String> urls = new ArrayList<>(size);
        for (HistoryNode n = head; n != null; n = n.getNext()) {
            urls.add(n.getUrl());
        }
        return new HistorySnapshot(
                size,
                position,
                current != null ? current.getUrl() : null,
                current != null && current.getPrev() != null,
                current != null && current.getNext() != null,
                Collections.unmodifiableList(urls));
    }

    public synchronized HistoryNode getHead() { return head; }
    public synchronized HistoryNode getCurrent() { return current; }
    public synchronized int getSize() { return size; }
    public synchronized int getPosition() { return position; }
}
