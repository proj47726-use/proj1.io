package com.browser.dsa.ds;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Unique domains visited.
 * Thin wrapper around HashSet so the teaching surface matches engine.js
 * (add returns whether the domain was new). Average O(1) for add / has / size.
 */
public class DomainSet {

    private final Set<String> items = new HashSet<>();

    /**
     * Add a domain. Returns true if it was not already present.
     */
    public synchronized boolean add(String domain) {
        return items.add(domain);
    }

    public synchronized boolean has(String domain) {
        return items.contains(domain);
    }

    public synchronized void clear() {
        items.clear();
    }

    public synchronized int size() {
        return items.size();
    }

    public synchronized List<String> values() {
        return new ArrayList<>(items);
    }
}
