package com.browser.dsa.model;

import java.util.List;

/**
 * An immutable, thread-safe picture of a history list at one moment.
 * The controller reads this instead of touching live nodes, so a request
 * can never see the list half-way through another request's change.
 */
public record HistorySnapshot(
        int size,
        int position,        // 1-based index of the current page, 0 when empty
        String currentUrl,   // null when empty
        boolean hasPrev,
        boolean hasNext,
        List<String> urls) {
}
