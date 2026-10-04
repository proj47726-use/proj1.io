package com.browser.dsa.controller;

import com.browser.dsa.ds.CustomDoublyLinkedList;
import com.browser.dsa.model.HistorySnapshot;
import com.browser.dsa.service.BrowserStateService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * History endpoints. Every call names a clientId (the browser window) and a tabId,
 * and each response describes the resulting state so the frontend can check it
 * agrees with its own copy.
 */
@RestController
@RequestMapping("/api/history")
public class HistoryController {

    private final BrowserStateService state;

    public HistoryController(BrowserStateService state) {
        this.state = state;
    }

    private CustomDoublyLinkedList list(String clientId, String tabId) {
        return state.history(RequestValidation.id(clientId, "clientId"),
                             RequestValidation.id(tabId, "tabId"));
    }

    @PostMapping("/visit")
    public ResponseEntity<Map<String, Object>> visit(
            @RequestParam(defaultValue = "anonymous") String clientId,
            @RequestParam(defaultValue = "1") String tabId,
            @RequestParam String url) {
        CustomDoublyLinkedList history = list(clientId, tabId);
        history.visit(RequestValidation.url(url));
        return ResponseEntity.ok(buildResponse("Visit: O(1)", history.snapshot()));
    }

    @PostMapping("/back")
    public ResponseEntity<Map<String, Object>> back(
            @RequestParam(defaultValue = "anonymous") String clientId,
            @RequestParam(defaultValue = "1") String tabId) {
        CustomDoublyLinkedList history = list(clientId, tabId);
        history.back();
        return ResponseEntity.ok(buildResponse("Back: O(1)", history.snapshot()));
    }

    @PostMapping("/forward")
    public ResponseEntity<Map<String, Object>> forward(
            @RequestParam(defaultValue = "anonymous") String clientId,
            @RequestParam(defaultValue = "1") String tabId) {
        CustomDoublyLinkedList history = list(clientId, tabId);
        history.forward();
        return ResponseEntity.ok(buildResponse("Forward: O(1)", history.snapshot()));
    }

    /** Jump to the page at a 1-based position. Costs O(k) for k steps travelled. */
    @PostMapping("/jump")
    public ResponseEntity<Map<String, Object>> jump(
            @RequestParam(defaultValue = "anonymous") String clientId,
            @RequestParam(defaultValue = "1") String tabId,
            @RequestParam int position) {
        CustomDoublyLinkedList history = list(clientId, tabId);
        if (history.jumpTo(position) == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "position must be between 1 and " + history.getSize());
        }
        return ResponseEntity.ok(buildResponse("Jump: O(k)", history.snapshot()));
    }

    @PostMapping("/clear")
    public ResponseEntity<Map<String, Object>> clear(
            @RequestParam(defaultValue = "anonymous") String clientId,
            @RequestParam(defaultValue = "1") String tabId) {
        CustomDoublyLinkedList history = list(clientId, tabId);
        history.clear();
        return ResponseEntity.ok(buildResponse("Clear History: O(1)", history.snapshot()));
    }

    /** Read-only view of the stored state, used by the frontend to verify it is in sync. */
    @GetMapping("/state")
    public ResponseEntity<Map<String, Object>> getState(
            @RequestParam(defaultValue = "anonymous") String clientId,
            @RequestParam(defaultValue = "1") String tabId) {
        return ResponseEntity.ok(buildResponse("State", list(clientId, tabId).snapshot()));
    }

    private Map<String, Object> buildResponse(String operation, HistorySnapshot snap) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("operation", operation);
        response.put("totalNodes", snap.size());
        response.put("position", snap.position());
        response.put("currentUrl", snap.currentUrl());
        response.put("hasPrev", snap.hasPrev());
        response.put("hasNext", snap.hasNext());
        response.put("urls", snap.urls());
        return response;
    }
}
