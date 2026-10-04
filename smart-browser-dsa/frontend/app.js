/*
 * app.js — draws the page and wires up the buttons.
 * All data-structure logic lives in engine.js; this file only shows it.
 *
 * Safety note: nothing here builds HTML from strings. Every piece of text is added
 * with textContent / text nodes, so a URL or bookmark name can never run as code.
 */
(function () {
    'use strict';

    const E = window.BrowserEngine;
    const API_BASE = window.SMART_BROWSER_API || 'http://localhost:8080/api';
    const STORAGE_KEY = 'smart-browser-dsa:v2';
    const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
    const GHOST_LIFETIME_MS = 2300;
    const MAX_GHOSTS_SHOWN = 6;
    const START_SITES = ['wikipedia.org', 'github.com', 'example.com', 'python.org'];

    const $ = id => document.getElementById(id);

    /** Build an element safely. Strings become text nodes, never HTML. */
    function h(tag, props, ...kids) {
        const el = document.createElement(tag);
        if (props) {
            Object.keys(props).forEach(key => {
                const value = props[key];
                if (value == null || value === false) return;
                if (key === 'class') el.className = value;
                else if (key === 'text') el.textContent = value;
                else if (key === 'dataset') Object.assign(el.dataset, value);
                else el.setAttribute(key, value === true ? '' : String(value));
            });
        }
        kids.flat().forEach(kid => { if (kid != null && kid !== false) el.append(kid); });
        return el;
    }

    // ------------------------------------------------------------------
    // State + saving (localStorage, so a refresh keeps everything)
    // ------------------------------------------------------------------

    let clientId = 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    let browser = loadBrowser();
    let lastResult = { op: 'Ready', explain: 'Visit a page and watch the data structures below react.' };
    let pendingGhosts = [];
    let toastTimer = null;

    function loadBrowser() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return new E.Browser();
            const saved = JSON.parse(raw);
            if (saved && typeof saved.clientId === 'string' && ID_PATTERN.test(saved.clientId)) clientId = saved.clientId;
            return E.Browser.fromJSON(saved && saved.browser);
        } catch (e) {
            return new E.Browser();   // storage blocked or data damaged: start fresh
        }
    }

    function save() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, clientId, browser: browser.toJSON() }));
        } catch (e) { /* storage full or blocked: the app still works, it just won't remember */ }
    }

    function toast(message) {
        const el = $('toast');
        el.textContent = message;
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
    }

    // ------------------------------------------------------------------
    // Backend sync
    // The Java backend keeps its own copy of the same lists. After every action we send
    // it the action, then compare its answer with our own state. If they ever disagree
    // (backend restarted, page refreshed...) we replay our state to it automatically.
    // Requests go through one queue so answers can never arrive out of order.
    // ------------------------------------------------------------------

    const SYNC_TEXT = {
        unknown: 'Backend: checking…',
        synced: 'Backend: in sync',
        resyncing: 'Backend: re-syncing…',
        offline: 'Backend: offline (local mode)',
        error: 'Backend: could not sync'
    };
    let syncChain = Promise.resolve();

    function setSync(state) {
        const badge = $('sync-badge');
        badge.dataset.state = state;
        badge.textContent = SYNC_TEXT[state];
    }

    async function call(method, endpoint, params) {
        const query = new URLSearchParams(Object.assign({ clientId }, params)).toString();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
            const response = await fetch(API_BASE + endpoint + '?' + query, { method, signal: controller.signal });
            if (!response.ok) return { ok: false, status: response.status };
            return { ok: true, data: await response.json() };
        } catch (e) {
            return { ok: false, offline: true };
        } finally {
            clearTimeout(timer);
        }
    }

    function matches(data, expected) {
        return Object.keys(expected).every(key => String(data[key]) === String(expected[key]));
    }

    function historyExpectation(history) {
        return {
            totalNodes: history.size,
            position: history.position,
            currentUrl: history.current ? history.current.url : null
        };
    }

    /** Queue a backend call and verify its answer against what we expect. */
    function sync(endpoint, params, expected, method) {
        syncChain = syncChain.then(async () => {
            const result = await call(method || 'POST', endpoint, params);
            if (result.offline) { setSync('offline'); return; }
            if (result.ok && matches(result.data, expected)) { setSync('synced'); return; }
            await resync();
        }).catch(() => setSync('error'));
    }

    function syncHistory(endpoint, extra) {
        const params = Object.assign({ tabId: String(browser.tabs.activeId) }, extra);
        sync(endpoint, params, historyExpectation(browser.history));
    }

    /** Wipe the backend's copy and rebuild it from ours. */
    async function resync() {
        setSync('resyncing');
        const fail = result => { setSync(result.offline ? 'offline' : 'error'); return false; };

        const replay = async tab => {
            const tabId = String(tab.id);
            for (const node of tab.history.toArray()) {
                const r = await call('POST', '/history/visit', { tabId, url: node.url });
                if (!r.ok) return fail(r);
            }
            if (tab.history.size > 0) {
                const r = await call('POST', '/history/jump', { tabId, position: tab.history.position });
                if (!r.ok) return fail(r);
            }
            return true;
        };

        const reset = await call('POST', '/session/reset', {});
        if (!reset.ok) return fail(reset);

        for (const tab of browser.tabs.closed.toArray()) {            // bottom of the stack first
            if (!(await replay(tab))) return;
            const r = await call('POST', '/tabs/close', { tabId: String(tab.id), title: tab.title });
            if (!r.ok) return fail(r);
        }
        for (const tab of browser.tabs.tabs) {
            if (!(await replay(tab))) return;
        }
        setSync('synced');
    }

    // ------------------------------------------------------------------
    // Actions: engine call -> remember -> redraw -> tell the backend
    // ------------------------------------------------------------------

    function finish(result, options) {
        const opts = options || {};
        lastResult = result;
        pendingGhosts = opts.ghosts || [];
        save();
        render(!opts.keepAddress);
    }

    function doNavigate(input) {
        const result = browser.navigate(input);
        if (!result.ok) {
            toast(result.error === 'too-long'
                ? 'That address is too long. The limit is 2048 characters.'
                : 'Type a web address or a search first.');
            return;
        }
        if (result.isSearch) result.explain = 'That wasn’t a web address, so it was searched on Google. ' + result.explain;
        finish(result, { ghosts: result.discardedUrls });
        syncHistory('/history/visit', { url: result.url });
    }

    function doBack() {
        const result = browser.back();
        if (!result.ok) return;
        finish(result);
        syncHistory('/history/back');
    }

    function doForward() {
        const result = browser.forward();
        if (!result.ok) return;
        finish(result);
        syncHistory('/history/forward');
    }

    function doJump(index) {
        const result = browser.jumpTo(index);
        if (!result.ok) return;
        finish(result);
        syncHistory('/history/jump', { position: browser.history.position });
    }

    function doReload() {
        const result = browser.reload();
        if (!result.ok) return;
        finish(result);
    }

    function doClearHistory() {
        if (!window.confirm('Clear the history of every tab? Bookmarks are kept.')) return;
        const result = browser.clearHistory();
        finish(result);
        const tabs = browser.tabs.tabs.concat(browser.tabs.closed.toArray());
        tabs.forEach(tab => {
            sync('/history/clear', { tabId: String(tab.id) }, { totalNodes: 0, position: 0, currentUrl: null });
        });
    }

    function doSwitchTab(id) {
        if (id === browser.tabs.activeId) return;
        const result = browser.switchTab(id);
        if (result.ok) finish(result);
    }

    function doNewTab() {
        finish(browser.newTab());
        $('address-bar').focus();
    }

    function doCloseTab(id) {
        const tab = browser.tabs.tabs.find(t => t.id === id);
        if (!tab) return;
        const title = tab.title;
        const result = browser.closeTab(id);
        if (!result.ok) return;
        finish(result);
        sync('/tabs/close', { tabId: String(id), title }, { stackSize: browser.tabs.closed.size() });
    }

    function doReopenTab() {
        const result = browser.reopenTab();
        if (!result.ok) return;
        finish(result);
        sync('/tabs/reopen', {}, { stackSize: browser.tabs.closed.size(), restoredTabId: String(result.tab.id) });
    }

    function doDownload() {
        const result = browser.enqueueDownload();
        if (result.ok) finish(result, { keepAddress: true });
    }

    function doProcessDownload() {
        const result = browser.processDownload();
        if (result.ok) finish(result, { keepAddress: true });
    }

    function doBookmarkToggle() {
        const result = browser.toggleBookmark();
        if (result.ok) finish(result, { keepAddress: true });
    }

    function doReset() {
        if (!window.confirm('Reset everything? This deletes all tabs, history, bookmarks and downloads.')) return;
        browser = new E.Browser();
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        finish({ op: 'Reset', explain: 'Every structure is empty again.' });
        sync('/session/reset', {}, { ok: true });
    }

    // ------------------------------------------------------------------
    // Drawing: toolbar, tabs, page
    // ------------------------------------------------------------------

    function render(forceAddress) {
        renderTabs();
        renderToolbar(forceAddress);
        renderViewport();
        renderDashboard();
    }

    function renderTabs() {
        const list = $('tabs-list');
        list.replaceChildren();
        browser.tabs.tabs.forEach(tab => {
            const selected = tab.id === browser.tabs.activeId;
            list.append(
                h('div', { class: 'tab' + (selected ? ' active' : ''), role: 'presentation' },
                    h('span', { class: 'fav', 'aria-hidden': 'true', text: tab.title.charAt(0).toUpperCase() }),
                    h('button', {
                        class: 'tab-title', type: 'button', role: 'tab',
                        'aria-selected': selected ? 'true' : 'false', tabindex: selected ? '0' : '-1',
                        title: tab.title, text: tab.title,
                        dataset: { action: 'switch-tab', id: tab.id }
                    }),
                    h('button', {
                        class: 'tab-close', type: 'button',
                        'aria-label': 'Close tab ' + tab.title, title: 'Close tab',
                        dataset: { action: 'close-tab', id: tab.id }, text: '×'
                    })
                )
            );
        });
    }

    function renderToolbar(forceAddress) {
        const history = browser.history;
        const current = browser.current;
        $('back-btn').disabled = !history.canGoBack();
        $('forward-btn').disabled = !history.canGoForward();
        $('reload-btn').disabled = !current;
        $('download-btn').disabled = !current;
        $('bookmark-btn').disabled = !current;

        const bookmarked = browser.isBookmarked();
        const star = $('bookmark-btn');
        star.textContent = bookmarked ? '★' : '☆';
        star.setAttribute('aria-pressed', bookmarked ? 'true' : 'false');
        star.title = bookmarked ? 'Remove bookmark' : 'Bookmark this page';

        const closedCount = browser.tabs.closed.size();
        $('reopen-tab-btn').disabled = closedCount === 0;
        $('reopen-count').textContent = String(closedCount);
        $('reopen-count').hidden = closedCount === 0;

        const bar = $('address-bar');
        if (forceAddress || document.activeElement !== bar) bar.value = current ? current.url : '';
    }

    function renderViewport() {
        const viewport = $('viewport');
        viewport.replaceChildren();
        const current = browser.current;

        if (!current) {
            viewport.append(
                h('div', { class: 'welcome-card' },
                    h('h1', { text: 'Where to?' }),
                    h('p', { text: 'Smart Browser System keeps every step you take in real data structures. Type a web address above, or pick a destination, then open the DSA dashboard to watch them work.' }),
                    h('div', { class: 'chips' },
                        START_SITES.map(site => h('button', { class: 'chip', type: 'button', text: site, dataset: { action: 'visit-chip', site } }))),
                    h('h2', { text: 'Three steps to see the history problem solved' }),
                    h('ol', null,
                        h('li', { text: 'Visit three different sites.' }),
                        h('li', { text: 'Press ← twice to go back to the first one.' }),
                        h('li', { text: 'Visit a new site. Watch the two “forward” pages get discarded in the history chain.' })
                    )
                )
            );
            return;
        }

        const domain = E.hostOf(current.url);
        const card = h('div', { class: 'page-card' },
            h('h2', { text: 'You are here' }),
            h('p', { class: 'page-domain', text: domain }),
            h('p', { class: 'page-url', text: current.url }),
            h('div', { class: 'page-meta' },
                h('span', null, 'Domain: ', h('strong', { text: domain })),
                h('span', null, 'First opened: ', h('strong', { text: current.time || 'unknown' })),
                h('span', null, 'Reloads: ', h('strong', { text: String(current.reloads) }))
            ),
            h('div', { class: 'page-note' },
                h('h3', { text: 'This is a simulated page' }),
                h('p', { text: 'Most real sites refuse to load inside another page, so this project shows the data structures instead. This page is one node in the history list: use Back, Forward, or visit something new and watch the list change.' })
            )
        );
        if (E.isSafeUrl(current.url) && current.url !== E.HOME_URL) {
            card.append(h('a', { class: 'real-link', href: current.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open the real page in a new tab' }));
        }
        viewport.append(card);
    }

    // ------------------------------------------------------------------
    // Drawing: dashboard
    // ------------------------------------------------------------------

    const emptyMessage = text => h('p', { class: 'empty-msg', text });

    function renderDashboard() {
        renderWhatsNew();
        renderHistory();
        renderStack();
        renderQueue();
        renderDomains();
        renderBookmarks();
        renderStats();
    }

    function renderWhatsNew() {
        $('whats-new').replaceChildren(
            h('span', { class: 'op', text: lastResult.op }),
            h('p', { text: lastResult.explain })
        );
    }

    function renderHistory() {
        const box = $('history-visualizer');
        box.replaceChildren();
        const tab = browser.tabs.active;
        const list = tab.history;

        box.append(h('p', { class: 'list-label', text: 'Showing the list for tab ' + tab.id + ' (' + tab.title + '). Each tab has its own.' }));
        if (!list.head) {
            box.append(emptyMessage('No history yet. Type a web address and press Go.'));
            return;
        }

        let currentEl = null;
        list.toArray().forEach((node, i) => {
            const index = i + 1;
            const isCurrent = node === list.current;
            const tags = [];
            if (node === list.head) tags.push('HEAD');
            if (isCurrent) tags.push('CURRENT');
            if (!node.next) tags.push('TAIL');

            const distance = Math.abs(index - list.position);
            const el = h('button', {
                class: 'node' + (isCurrent ? ' current' : ''), type: 'button',
                'aria-current': isCurrent ? 'true' : null,
                title: isCurrent ? 'You are here' : 'Jump here (walks ' + distance + (distance === 1 ? ' node)' : ' nodes)'),
                dataset: { action: 'jump', index }
            },
                h('div', { class: 'row' },
                    h('span', { class: 'name', text: index + '. ' + E.shortUrl(node.url) }),
                    h('span', { class: 'tag', text: tags.join(' · ') })
                ),
                h('div', { class: 'sub', text: (node.prev ? '← previous' : 'first page') + '  ·  ' + (node.next ? 'next →' : 'last page') })
            );
            if (isCurrent) currentEl = el;
            box.append(el);
            if (node.next) box.append(h('div', { class: 'link', 'aria-hidden': 'true', text: '⇅' }));
        });

        if (pendingGhosts.length) {
            const label = h('p', { class: 'ghost-label', text: 'Just discarded from the chain:' });
            const shown = pendingGhosts.slice(0, MAX_GHOSTS_SHOWN);
            const ghosts = shown.map(url => h('div', { class: 'node ghost', 'aria-hidden': 'true' },
                h('div', { class: 'row' },
                    h('span', { class: 'name', text: E.shortUrl(url) }),
                    h('span', { class: 'tag', text: 'discarded' })
                )));
            const more = pendingGhosts.length - shown.length;
            const note = more > 0 ? h('p', { class: 'ghost-label', text: '…and ' + more + ' more' }) : null;
            const extras = [label].concat(ghosts, note ? [note] : []);
            extras.forEach(el => box.append(el));
            setTimeout(() => extras.forEach(el => el.remove()), GHOST_LIFETIME_MS);
            pendingGhosts = [];
        }

        // Keep the current station visible inside the history box. Only that box scrolls, never the whole dashboard.
        if (currentEl) {
            const boxRect = box.getBoundingClientRect();
            const nodeRect = currentEl.getBoundingClientRect();
            if (nodeRect.top < boxRect.top) box.scrollTop -= (boxRect.top - nodeRect.top) + 14;
            else if (nodeRect.bottom > boxRect.bottom) box.scrollTop += (nodeRect.bottom - boxRect.bottom) + 8;
        }
    }

    function renderStack() {
        const box = $('stack-visualizer');
        box.replaceChildren();
        const closed = browser.tabs.closed.toArray().reverse();      // top of the stack first
        if (closed.length === 0) { box.append(emptyMessage('The stack is empty. Close a tab to push it here.')); return; }
        closed.forEach((tab, i) => {
            box.append(h('div', { class: 'node stack' },
                h('div', { class: 'row' },
                    h('span', { class: 'name', text: '“' + tab.title + '”' }),
                    h('span', { class: 'tag', text: i === 0 ? 'TOP · reopens next' : '' })
                ),
                h('div', { class: 'sub', text: tab.history.size + (tab.history.size === 1 ? ' page' : ' pages') + ' of history · closed at ' + (tab.closedAt || '?') })
            ));
        });
    }

    function renderQueue() {
        const box = $('queue-visualizer');
        const done = $('completed-visualizer');
        box.replaceChildren();
        done.replaceChildren();

        const waiting = browser.downloads.toArray();
        $('process-download-btn').disabled = waiting.length === 0;
        if (waiting.length === 0) box.append(emptyMessage('The queue is empty. Press ⬇ Download to add the current page.'));
        waiting.forEach((item, i) => {
            box.append(h('div', { class: 'node queue' },
                h('div', { class: 'row' },
                    h('span', { class: 'name', text: item.name }),
                    h('span', { class: 'tag', text: i === 0 ? 'FRONT · processed next' : '' })
                ),
                h('div', { class: 'sub', text: 'Added at ' + item.time })
            ));
        });

        if (browser.completed.length) {
            done.append(h('p', { class: 'list-label', text: 'Finished downloads (newest first)' }));
            browser.completed.forEach(item => {
                done.append(h('div', { class: 'node done' },
                    h('div', { class: 'row' },
                        h('span', { class: 'name', text: item.name }),
                        h('span', { class: 'tag', text: '✓ ' + item.doneAt })
                    )));
            });
        }
    }

    function renderDomains() {
        const box = $('set-visualizer');
        box.replaceChildren();
        const domains = browser.domains.values();
        if (domains.length === 0) { box.append(emptyMessage('No domains yet. Each site you visit is added once.')); return; }
        domains.forEach(domain => {
            box.append(h('div', { class: 'node domain' }, h('div', { class: 'row' }, h('span', { class: 'name', text: domain }))));
        });
    }

    function renderBookmarks() {
        const box = $('bookmark-visualizer');
        box.replaceChildren();
        const tree = browser.bookmarks;

        const walk = (node, depth) => {
            const isTarget = node.isFolder && node.id === browser.bookmarkTargetId;
            const row = h('div', { class: 'tree-row' + (isTarget ? ' target' : ''), style: 'padding-left:' + (depth * 14) + 'px' });
            if (node.isFolder) {
                row.append(h('button', {
                    class: 'tree-btn', type: 'button', title: 'Put new bookmarks in this folder',
                    'aria-pressed': isTarget ? 'true' : 'false',
                    dataset: { action: 'select-folder', id: node.id }, text: '▾ ' + node.name
                }));
            } else {
                row.append(h('button', {
                    class: 'tree-btn', type: 'button', title: node.url,
                    dataset: { action: 'open-bookmark', url: node.url }, text: '◦ ' + node.name
                }));
            }
            if (node.id !== tree.root.id) {
                row.append(h('button', {
                    class: 'tree-remove', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + node.name,
                    dataset: { action: 'remove-node', id: node.id }, text: '×'
                }));
            }
            box.append(row);
            node.children.forEach(child => walk(child, depth + 1));
        };
        walk(tree.root, 0);

        const target = tree.find(browser.bookmarkTargetId) || tree.favorites;
        box.append(h('p', { class: 'tree-hint', text: 'The ☆ button saves into: ' + target.name }));
    }

    function renderStats() {
        $('stat-nodes').textContent = String(browser.history.size);
        $('stat-stack').textContent = String(browser.tabs.closed.size());
        $('stat-queue').textContent = String(browser.downloads.size());
        $('stat-set').textContent = String(browser.domains.size());
        $('stat-bookmarks').textContent = String(browser.bookmarks.countBookmarks());
        $('stat-complexity').textContent = lastResult.op;
    }

    // ------------------------------------------------------------------
    // Wiring
    // ------------------------------------------------------------------

    function setDashboardOpen(open) {
        $('dsa-dashboard').classList.toggle('hidden', !open);
        $('toggle-dsa-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('address-form').addEventListener('submit', event => {
            event.preventDefault();
            doNavigate($('address-bar').value);
        });
        $('back-btn').addEventListener('click', doBack);
        $('forward-btn').addEventListener('click', doForward);
        $('reload-btn').addEventListener('click', doReload);
        $('home-btn').addEventListener('click', () => doNavigate(E.HOME_URL));
        $('clear-history-btn').addEventListener('click', doClearHistory);
        $('download-btn').addEventListener('click', doDownload);
        $('process-download-btn').addEventListener('click', doProcessDownload);
        $('bookmark-btn').addEventListener('click', doBookmarkToggle);
        $('new-tab-btn').addEventListener('click', doNewTab);
        $('reopen-tab-btn').addEventListener('click', doReopenTab);
        $('reset-all-btn').addEventListener('click', doReset);
        $('toggle-dsa-btn').addEventListener('click', () => setDashboardOpen($('dsa-dashboard').classList.contains('hidden')));
        $('close-dsa-btn').addEventListener('click', () => setDashboardOpen(false));

        $('tabs-list').addEventListener('click', event => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const id = Number(target.dataset.id);
            if (target.dataset.action === 'switch-tab') doSwitchTab(id);
            if (target.dataset.action === 'close-tab') doCloseTab(id);
        });

        $('viewport').addEventListener('click', event => {
            const chip = event.target.closest('[data-action="visit-chip"]');
            if (chip) doNavigate(chip.dataset.site);
        });

        $('dsa-dashboard').addEventListener('click', event => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            if (action === 'jump') doJump(Number(target.dataset.index));
            else if (action === 'open-bookmark') doNavigate(target.dataset.url);
            else if (action === 'select-folder') {
                if (browser.selectBookmarkFolder(Number(target.dataset.id))) { save(); renderDashboard(); }
            } else if (action === 'remove-node') {
                const result = browser.removeBookmarkNode(Number(target.dataset.id));
                if (result.ok) finish(result, { keepAddress: true });
            }
        });

        $('folder-form').addEventListener('submit', event => {
            event.preventDefault();
            const result = browser.addFolder($('folder-name').value);
            if (!result.ok) { toast('Enter a folder name first.'); return; }
            $('folder-name').value = '';
            finish(result, { keepAddress: true });
        });

        setDashboardOpen(window.matchMedia && window.matchMedia('(min-width: 821px)').matches);
        setSync('unknown');
        render(true);

        // Check whether the backend (if running) already agrees with our saved state.
        sync('/history/state', { tabId: String(browser.tabs.activeId) }, historyExpectation(browser.history), 'GET');
    });
})();
