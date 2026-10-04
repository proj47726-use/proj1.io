package com.browser.dsa.ds;

import com.browser.dsa.model.TabNode;

/** Linked-list stack (LIFO) holding recently closed tabs. */
public class CustomStack {
    private static class Node {
        final TabNode data;
        Node next;

        Node(TabNode data) {
            this.data = data;
        }
    }

    private Node top;
    private int size;

    /** Put a tab on top of the pile. O(1). */
    public synchronized void push(TabNode tab) {
        Node newNode = new Node(tab);
        newNode.next = top;
        top = newNode;
        size++;
    }

    /** Take the top tab off the pile, or null if empty. O(1). */
    public synchronized TabNode pop() {
        if (top == null) return null;
        TabNode poppedData = top.data;
        top = top.next;
        size--;
        return poppedData;
    }

    /** Look at the top tab without removing it, or null if empty. O(1). */
    public synchronized TabNode peek() {
        return top == null ? null : top.data;
    }

    public synchronized boolean isEmpty() {
        return top == null;
    }

    public synchronized int getSize() {
        return size;
    }
}
