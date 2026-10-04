package com.browser.dsa.service;

import com.browser.dsa.ds.CustomDoublyLinkedList;
import com.browser.dsa.ds.CustomStack;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Keeps one independent browser state per client (one per browser window/page)
 * so two people using the API never see each other's history.
 * Each client owns a separate history list per tab, plus one closed-tab stack.
 *
 * Limitation (fine for a learning project): state lives in memory only, and
 * once MAX_CLIENTS is reached an arbitrary older client is dropped.
 */
@Service
public class BrowserStateService {
    private static final int MAX_CLIENTS = 500;

    private static final class ClientState {
        final Map<String, CustomDoublyLinkedList> histories = new ConcurrentHashMap<>();
        final CustomStack closedTabs = new CustomStack();
    }

    private final Map<String, ClientState> clients = new ConcurrentHashMap<>();

    private ClientState client(String clientId) {
        ClientState existing = clients.get(clientId);
        if (existing != null) return existing;
        if (clients.size() >= MAX_CLIENTS) {
            clients.keySet().stream().findFirst().ifPresent(clients::remove);
        }
        return clients.computeIfAbsent(clientId, id -> new ClientState());
    }

    public CustomDoublyLinkedList history(String clientId, String tabId) {
        return client(clientId).histories.computeIfAbsent(tabId, id -> new CustomDoublyLinkedList());
    }

    public CustomStack closedTabs(String clientId) {
        return client(clientId).closedTabs;
    }

    /** Forget everything stored for this client. */
    public void reset(String clientId) {
        clients.remove(clientId);
    }
}
