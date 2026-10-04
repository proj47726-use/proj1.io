package com.browser.dsa.model;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/** A closed tab waiting on the stack. Its history stays stored under tabId. */
public class TabNode {
    private final String tabId;
    private final String title;
    private final String closedTime;

    public TabNode(String tabId, String title) {
        this.tabId = tabId;
        this.title = title;
        this.closedTime = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"));
    }

    public String getTabId() { return tabId; }
    public String getTitle() { return title; }
    public String getClosedTime() { return closedTime; }
}
