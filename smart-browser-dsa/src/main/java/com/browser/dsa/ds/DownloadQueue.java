package com.browser.dsa.ds;

import java.util.ArrayList;
import java.util.List;

/**
 * Linked-list queue with head and tail pointers (FIFO).
 * Matches engine.js DownloadQueue: enqueue and dequeue are both O(1).
 * Used for the download manager.
 */
public class DownloadQueue<T> {

    private static class Node<T> {
        final T item;
        Node<T> next;

        Node(T item) {
            this.item = item;
        }
    }

    private Node<T> head;
    private Node<T> tail;
    private int count;

    /** Attach at the tail. O(1). */
    public synchronized void enqueue(T item) {
        Node<T> node = new Node<>(item);
        if (tail != null) {
            tail.next = node;
        } else {
            head = node;
        }
        tail = node;
        count++;
    }

    /** Detach from the head. O(1). Returns null if empty. */
    public synchronized T dequeue() {
        if (head == null) {
            return null;
        }
        T item = head.item;
        head = head.next;
        if (head == null) {
            tail = null;
        }
        count--;
        return item;
    }

    /** Look at the front without removing. O(1). */
    public synchronized T peek() {
        return head == null ? null : head.item;
    }

    public synchronized boolean isEmpty() {
        return count == 0;
    }

    public synchronized int size() {
        return count;
    }

    /** Front → back order. */
    public synchronized List<T> toList() {
        List<T> out = new ArrayList<>(count);
        for (Node<T> n = head; n != null; n = n.next) {
            out.add(n.item);
        }
        return out;
    }
}
