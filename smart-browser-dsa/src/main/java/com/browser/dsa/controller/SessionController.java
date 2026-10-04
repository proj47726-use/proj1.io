package com.browser.dsa.controller;

import com.browser.dsa.service.BrowserStateService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/** Lets the frontend wipe its server-side copy ("Reset everything", or before re-syncing). */
@RestController
@RequestMapping("/api/session")
public class SessionController {

    private final BrowserStateService state;

    public SessionController(BrowserStateService state) {
        this.state = state;
    }

    @PostMapping("/reset")
    public ResponseEntity<Map<String, Object>> reset(
            @RequestParam(defaultValue = "anonymous") String clientId) {
        state.reset(RequestValidation.id(clientId, "clientId"));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("operation", "Reset Session");
        response.put("ok", true);
        return ResponseEntity.ok(response);
    }
}
