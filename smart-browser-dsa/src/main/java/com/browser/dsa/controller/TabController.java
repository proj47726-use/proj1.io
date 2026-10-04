package com.browser.dsa.controller;

import com.browser.dsa.ds.CustomStack;
import com.browser.dsa.model.TabNode;
import com.browser.dsa.service.BrowserStateService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/** Closed-tab stack. Closing pushes, reopening pops (last closed, first reopened). */
@RestController
@RequestMapping("/api/tabs")
public class TabController {

    private final BrowserStateService state;

    public TabController(BrowserStateService state) {
        this.state = state;
    }

    @PostMapping("/close")
    public ResponseEntity<Map<String, Object>> closeTab(
            @RequestParam(defaultValue = "anonymous") String clientId,
            @RequestParam(defaultValue = "1") String tabId,
            @RequestParam(required = false) String title) {
        CustomStack stack = state.closedTabs(RequestValidation.id(clientId, "clientId"));
        stack.push(new TabNode(RequestValidation.id(tabId, "tabId"), RequestValidation.title(title)));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("operation", "Close Tab (Push): O(1)");
        response.put("stackSize", stack.getSize());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/reopen")
    public ResponseEntity<Map<String, Object>> reopenTab(
            @RequestParam(defaultValue = "anonymous") String clientId) {
        CustomStack stack = state.closedTabs(RequestValidation.id(clientId, "clientId"));
        TabNode tab = stack.pop();
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("operation", "Reopen Tab (Pop): O(1)");
        response.put("restoredTabId", tab != null ? tab.getTabId() : null);
        response.put("restoredTab", tab != null ? tab.getTitle() : null);
        response.put("stackSize", stack.getSize());
        return ResponseEntity.ok(response);
    }
}
