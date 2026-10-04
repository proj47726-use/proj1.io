package com.browser.dsa.model;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/** One visited page. Knows the page before it (prev) and after it (next). */
public class HistoryNode {
    private final String url;
    private final String timestamp;
    private HistoryNode prev;
    private HistoryNode next;

    public HistoryNode(String url) {
        this.url = url;
        this.timestamp = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"));
    }

    public String getUrl() { return url; }
    public String getTimestamp() { return timestamp; }
    public HistoryNode getPrev() { return prev; }
    public void setPrev(HistoryNode prev) { this.prev = prev; }
    public HistoryNode getNext() { return next; }
    public void setNext(HistoryNode next) { this.next = next; }
}
