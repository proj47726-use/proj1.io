/*
 * engine.js — every data structure and all browser logic, with NO screen code.
 *
 * Keeping this separate from app.js (which draws the page) means the logic can be
 * tested on its own:   node --test frontend/engine.test.js
 *
 * Works in a browser (exposes window.BrowserEngine) and in Node (module.exports).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BrowserEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_URL_LENGTH = 2048;
    const HOME_URL = 'https://home.browser/';
    const MAX_COMPLETED = 8;
    const MAX_FIELD_LENGTH = 100;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** True only for web addresses we are willing to show as links. */
    function isSafeUrl(value) {
        return typeof value === 'string' && /^https?:\/\//i.test(value) && value.length <= MAX_URL_LENGTH;
    }

    function hostOf(url) {
        try { return new URL(url).hostname || 'localhost'; }
        catch (e) { return 'localhost'; }
    }

    /** "github.com/user/repo" style label for a URL. */
    function shortUrl(url) {
        try {
            const u = new URL(url);
            return u.hostname + (u.pathname !== '/' ? u.pathname : '');
        } catch (e) { return url; }
    }

    const HOST_LIKE = /^(localhost|(?:[a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:[/?#].*)?$/i;

    /**
     * Turn whatever the user typed into a safe web address.
     *   "github.com"      -> https://github.com/
     *   "localhost:3000"  -> http://localhost:3000/
     *   "best pizza"      -> a Google search URL
     * Anything that is not plain http/https (javascript:, file:, ...) becomes a search,
     * so it can never run as code or open a local file.
     * Returns { url, isSearch } or { error: 'empty' | 'too-long' }.
     */
    function normalizeInput(raw) {
        const text = String(raw == null ? '' : raw).trim();
        if (!text) return { error: 'empty' };

        let candidate = null;
        if (/^https?:\/\//i.test(text)) candidate = text;
        else if (HOST_LIKE.test(text)) candidate = (/^localhost/i.test(text) ? 'http://' : 'https://') + text;

        if (candidate) {
            try { candidate = new URL(candidate).href; }
            catch (e) { candidate = null; }
        }

        const url = candidate || 'https://www.google.com/search?q=' + encodeURIComponent(text);
        if (url.length > MAX_URL_LENGTH) return { error: 'too-long' };
        return { url, isSearch: !candidate };
    }

    // ------------------------------------------------------------------
    // 1. Doubly linked list — browser history
    // ------------------------------------------------------------------

    class HistoryNode {
        constructor(url, time) {
            this.url = url;
            this.time = time;      // when it was first opened
            this.reloads = 0;
            this.prev = null;      // page before this one
            this.next = null;      // page after this one
        }
    }

    /**
     * HEAD <-> [a] <-> [b] <-> [c]      current points at one node.
     * We track `position` (1-based index of current) and `size`.
     * Because of that, visit() knows how many pages it is discarding (size - position)
     * without walking them, so it is genuinely O(1).
     */
    class HistoryList {
        constructor() {
            this.head = null;
            this.current = null;
            this.size = 0;
            this.position = 0;
        }

        /** Open a new page after current; forward pages are dropped. O(1). */
        visit(url, time) {
            const node = new HistoryNode(url, time);
            let discarded = 0;
            if (!this.head) {
                this.head = node;
                this.current = node;
                this.position = 1;
            } else {
                discarded = this.size - this.position;
                this.current.next = node;   // this one line cuts off every forward page
                node.prev = this.current;
                this.current = node;
                this.position++;
            }
            this.size = this.position;
            return { node, discarded };
        }

        canGoBack() { return !!(this.current && this.current.prev); }
        canGoForward() { return !!(this.current && this.current.next); }

        /** O(1). Returns true if it moved. */
        back() {
            if (!this.canGoBack()) return false;
            this.current = this.current.prev;
            this.position--;
            return true;
        }

        /** O(1). Returns true if it moved. */
        forward() {
            if (!this.canGoForward()) return false;
            this.current = this.current.next;
            this.position++;
            return true;
        }

        /** Jump to a 1-based index. O(k) for k steps. Returns steps taken, or -1 if invalid. */
        jumpTo(index) {
            if (!Number.isInteger(index) || index < 1 || index > this.size) return -1;
            let steps = 0;
            while (this.position > index) { this.current = this.current.prev; this.position--; steps++; }
            while (this.position < index) { this.current = this.current.next; this.position++; steps++; }
            return steps;
        }

        /** Forget everything. O(1): drop the head pointer. */
        clear() {
            this.head = null;
            this.current = null;
            this.size = 0;
            this.position = 0;
        }

        /** Pages after current. O(k). Only used to *show* what a visit discards. */
        forwardNodes() {
            const out = [];
            for (let n = this.current && this.current.next; n; n = n.next) out.push(n);
            return out;
        }

        toArray() {
            const out = [];
            for (let n = this.head; n; n = n.next) out.push(n);
            return out;
        }

        toJSON() {
            return {
                nodes: this.toArray().map(n => ({ url: n.url, time: n.time, reloads: n.reloads })),
                position: this.position
            };
        }

        static fromJSON(data) {
            const list = new HistoryList();
            if (!data || !Array.isArray(data.nodes)) return list;
            let kept = 0;
            let position = 0;
            data.nodes.forEach((raw, i) => {
                if (!raw || !isSafeUrl(raw.url)) return;
                const { node } = list.visit(raw.url, typeof raw.time === 'string' ? raw.time : '');
                node.reloads = Number.isInteger(raw.reloads) && raw.reloads > 0 ? raw.reloads : 0;
                kept++;
                if (i + 1 === data.position) position = kept;
            });
            if (kept > 0) list.jumpTo(position >= 1 ? position : kept);
            return list;
        }
    }

    // ------------------------------------------------------------------
    // 2. Stack — recently closed tabs (LIFO)
    // ------------------------------------------------------------------

    class TabStack {
        constructor() { this.items = []; }
        push(item) { this.items.push(item); }                             // O(1)
        pop() { return this.items.length ? this.items.pop() : null; }     // O(1)
        peek() { return this.items.length ? this.items[this.items.length - 1] : null; }
        isEmpty() { return this.items.length === 0; }
        size() { return this.items.length; }
        /** Bottom -> top. */
        toArray() { return this.items.slice(); }
    }

    // ------------------------------------------------------------------
    // 3. Queue — download manager (FIFO)
    // Linked list with head and tail pointers. (Array.shift() is NOT guaranteed O(1).)
    // ------------------------------------------------------------------

    class DownloadQueue {
        constructor() {
            this.head = null;
            this.tail = null;
            this.count = 0;
        }
        enqueue(item) {                       // O(1): attach at the tail
            const node = { item, next: null };
            if (this.tail) this.tail.next = node;
            else this.head = node;
            this.tail = node;
            this.count++;
        }
        dequeue() {                           // O(1): detach from the head
            if (!this.head) return null;
            const node = this.head;
            this.head = node.next;
            if (!this.head) this.tail = null;
            this.count--;
            return node.item;
        }
        peek() { return this.head ? this.head.item : null; }
        isEmpty() { return this.count === 0; }
        size() { return this.count; }
        /** Front -> back. */
        toArray() {
            const out = [];
            for (let n = this.head; n; n = n.next) out.push(n.item);
            return out;
        }
    }

    // ------------------------------------------------------------------
    // 4. Set — unique domains
    // ------------------------------------------------------------------

    class DomainSet {
        constructor() { this.items = new Set(); }
        add(domain) {                         // O(1) average. Returns true if it was new.
            const isNew = !this.items.has(domain);
            this.items.add(domain);
            return isNew;
        }
        has(domain) { return this.items.has(domain); }
        clear() { this.items.clear(); }
        size() { return this.items.size; }
        values() { return Array.from(this.items); }
    }

    // ------------------------------------------------------------------
    // 5. N-ary tree — bookmarks (folders hold folders and links)
    // ------------------------------------------------------------------

    class BookmarkNode {
        constructor(id, name, isFolder, url) {
            this.id = id;
            this.name = name;
            this.isFolder = isFolder;
            this.url = url || null;
            this.children = [];
        }
    }

    class BookmarkTree {
        constructor() {
            this.nextId = 1;
            this.root = new BookmarkNode(0, 'Bookmarks', true);
            this.favorites = this.addFolder(0, 'Favorites');
        }

        /** Depth-first search. O(n). Returns { node, parent } or null. */
        _find(predicate) {
            const stack = [{ node: this.root, parent: null }];
            while (stack.length) {
                const entry = stack.pop();
                if (predicate(entry.node)) return entry;
                entry.node.children.forEach(child => stack.push({ node: child, parent: entry.node }));
            }
            return null;
        }
        find(id) { const hit = this._find(n => n.id === id); return hit ? hit.node : null; }
        findByUrl(url) { const hit = this._find(n => !n.isFolder && n.url === url); return hit ? hit.node : null; }

        /** O(n) to locate the parent, O(1) to attach. Returns the new node or null. */
        addFolder(parentId, name) {
            const parent = this.find(parentId);
            if (!parent || !parent.isFolder) return null;
            const node = new BookmarkNode(this.nextId++, name, true);
            parent.children.push(node);
            return node;
        }
        /** Returns the new node, or null if the parent is invalid or the URL is already bookmarked. */
        addBookmark(parentId, name, url) {
            const parent = this.find(parentId);
            if (!parent || !parent.isFolder || this.findByUrl(url)) return null;
            const node = new BookmarkNode(this.nextId++, name, false, url);
            parent.children.push(node);
            return node;
        }
        /** Removes a node and everything under it. The root cannot be removed. O(n). */
        remove(id) {
            if (id === this.root.id) return false;
            const hit = this._find(n => n.id === id);
            if (!hit) return false;
            hit.parent.children = hit.parent.children.filter(c => c.id !== id);
            return true;
        }
        /** Number of links (folders are not counted). */
        countBookmarks() {
            let total = 0;
            const walk = n => { if (!n.isFolder) total++; n.children.forEach(walk); };
            walk(this.root);
            return total;
        }

        toJSON() {
            const dump = n => ({ id: n.id, name: n.name, isFolder: n.isFolder, url: n.url, children: n.children.map(dump) });
            return { nextId: this.nextId, root: dump(this.root) };
        }
        static fromJSON(data) {
            const tree = new BookmarkTree();
            if (!data || !data.root || !Array.isArray(data.root.children)) return tree;
            let highestId = 0;
            const build = (raw, depth) => {
                if (!raw || depth > 20 || typeof raw.name !== 'string' || !Number.isInteger(raw.id)) return null;
                const isFolder = !!raw.isFolder;
                if (!isFolder && !isSafeUrl(raw.url)) return null;
                const node = new BookmarkNode(raw.id, raw.name.slice(0, MAX_FIELD_LENGTH), isFolder, isFolder ? null : raw.url);
                highestId = Math.max(highestId, raw.id);
                if (isFolder && Array.isArray(raw.children)) {
                    raw.children.forEach(c => { const child = build(c, depth + 1); if (child) node.children.push(child); });
                }
                return node;
            };
            tree.root.children = [];
            data.root.children.forEach(c => { const child = build(c, 1); if (child) tree.root.children.push(child); });
            tree.nextId = Math.max(highestId + 1, Number.isInteger(data.nextId) ? data.nextId : 1);
            const fav = tree.root.children.find(c => c.isFolder && c.name === 'Favorites');
            tree.favorites = fav || tree.addFolder(0, 'Favorites');
            return tree;
        }
    }

    // ------------------------------------------------------------------
    // Tabs — each tab owns its own history list
    // ------------------------------------------------------------------

    class Tab {
        constructor(id) {
            this.id = id;
            this.history = new HistoryList();
            this.closedAt = null;
        }
        get title() {
            return this.history.current ? hostOf(this.history.current.url) : 'New Tab';
        }
    }

    class TabManager {
        constructor() {
            this.tabs = [];
            this.activeId = null;
            this.nextId = 1;
            this.closed = new TabStack();
            this.newTab();
        }
        get active() { return this.tabs.find(t => t.id === this.activeId); }

        newTab() {
            const tab = new Tab(this.nextId++);
            this.tabs.push(tab);
            this.activeId = tab.id;
            return tab;
        }
        switchTo(id) {
            if (!this.tabs.some(t => t.id === id)) return false;
            this.activeId = id;
            return true;
        }
        /**
         * Closes a tab and pushes it (with its whole history) onto the stack.
         * Closing the last tab opens a fresh blank one so there is always a tab.
         */
        close(id, time) {
            const index = this.tabs.findIndex(t => t.id === id);
            if (index === -1) return null;
            const tab = this.tabs[index];
            tab.closedAt = time;
            this.tabs.splice(index, 1);
            this.closed.push(tab);
            let replacement = null;
            if (this.tabs.length === 0) replacement = this.newTab();
            else if (this.activeId === id) this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)].id;
            return { tab, replacement };
        }
        /** Pops the most recently closed tab and makes it active again. */
        reopen() {
            const tab = this.closed.pop();
            if (!tab) return null;
            tab.closedAt = null;
            this.tabs.push(tab);
            this.activeId = tab.id;
            return tab;
        }

        toJSON() {
            const dump = t => ({ id: t.id, history: t.history.toJSON(), closedAt: t.closedAt });
            return {
                tabs: this.tabs.map(dump),
                activeId: this.activeId,
                nextId: this.nextId,
                closed: this.closed.toArray().map(dump)     // bottom -> top
            };
        }
        static fromJSON(data) {
            const manager = new TabManager();
            if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return manager;
            const load = raw => {
                if (!raw || !Number.isInteger(raw.id) || raw.id < 1) return null;
                const tab = new Tab(raw.id);
                tab.history = HistoryList.fromJSON(raw.history);
                tab.closedAt = typeof raw.closedAt === 'string' ? raw.closedAt : null;
                return tab;
            };
            const seen = new Set();
            const unique = tab => tab && !seen.has(tab.id) && seen.add(tab.id);
            manager.tabs = data.tabs.map(load).filter(unique);
            manager.closed = new TabStack();
            (Array.isArray(data.closed) ? data.closed : []).map(load).filter(unique).forEach(t => manager.closed.push(t));
            if (manager.tabs.length === 0) {
                const freshId = Math.max(0, ...seen) + 1;
                manager.tabs = [new Tab(freshId)];
                seen.add(freshId);
            }
            const highest = Math.max(0, ...seen);
            manager.nextId = Math.max(highest + 1, Number.isInteger(data.nextId) ? data.nextId : 1);
            manager.activeId = manager.tabs.some(t => t.id === data.activeId) ? data.activeId : manager.tabs[0].id;
            return manager;
        }
    }

    // ------------------------------------------------------------------
    // Browser — ties everything together.
    // Every action returns { ok, op, explain, ... } so the page can show
    // the complexity and a plain-English description of what happened.
    // ------------------------------------------------------------------

    class Browser {
        constructor(options) {
            const opts = options || {};
            this.clock = opts.clock || (() => new Date().toLocaleTimeString());
            this.tabs = new TabManager();
            this.downloads = new DownloadQueue();
            this.completed = [];
            this.domains = new DomainSet();
            this.bookmarks = new BookmarkTree();
            this.bookmarkTargetId = this.bookmarks.favorites.id;
        }

        get history() { return this.tabs.active.history; }
        get current() { return this.history.current; }

        // ---- history ----------------------------------------------------

        navigate(input) {
            const parsed = normalizeInput(input);
            if (parsed.error) return { ok: false, error: parsed.error };

            const history = this.history;
            const discardedUrls = history.forwardNodes().map(n => n.url);   // O(k), only to show in the UI
            const { discarded } = history.visit(parsed.url, this.clock());  // the real work: O(1)

            const domain = hostOf(parsed.url);
            this.domains.add(domain);

            let explain;
            if (history.size === 1) {
                explain = 'Created the first node. HEAD and CURRENT both point to ' + domain + '.';
            } else if (discarded > 0) {
                explain = 'Attached ' + domain + ' after CURRENT and cut the link to ' + discarded +
                    (discarded === 1 ? ' forward page' : ' forward pages') +
                    '. One pointer changed — no other page had to move.';
            } else {
                explain = 'Attached ' + domain + ' after the last page and moved CURRENT onto it.';
            }
            return { ok: true, url: parsed.url, isSearch: parsed.isSearch, discarded, discardedUrls, op: 'Visit: O(1)', explain };
        }

        back() {
            if (!this.history.back()) return { ok: false };
            return {
                ok: true, op: 'Back: O(1)',
                explain: 'Moved CURRENT one node to the left, onto ' + hostOf(this.current.url) +
                    '. Nothing was deleted, so Forward still works.'
            };
        }

        forward() {
            if (!this.history.forward()) return { ok: false };
            return {
                ok: true, op: 'Forward: O(1)',
                explain: 'Moved CURRENT one node to the right, onto ' + hostOf(this.current.url) + '.'
            };
        }

        jumpTo(index) {
            const steps = this.history.jumpTo(index);
            if (steps < 0) return { ok: false };
            if (steps === 0) return { ok: false, same: true };
            return {
                ok: true, op: 'Jump: O(k), k = ' + steps,
                explain: 'Walked ' + steps + (steps === 1 ? ' node' : ' nodes') + ' along the chain to ' +
                    hostOf(this.current.url) + '. Cost grows with the distance, unlike Back and Forward.'
            };
        }

        reload() {
            const node = this.current;
            if (!node) return { ok: false };
            node.reloads++;
            return {
                ok: true, op: 'Reload: O(1)',
                explain: 'Reloaded ' + hostOf(node.url) + '. The history chain is untouched — reloading never adds a node.'
            };
        }

        home() { return this.navigate(HOME_URL); }

        /** Clears every tab's history and the unique-domain set. Bookmarks stay (as in real browsers). */
        clearHistory() {
            this.tabs.tabs.forEach(t => t.history.clear());
            this.tabs.closed.toArray().forEach(t => t.history.clear());
            this.domains.clear();
            return {
                ok: true, op: 'Clear History: O(t) for t tabs',
                explain: 'Dropped the HEAD pointer of every tab’s list (O(1) each) and emptied the domain set. Bookmarks are kept.'
            };
        }

        // ---- tabs -------------------------------------------------------

        newTab() {
            this.tabs.newTab();
            return { ok: true, op: 'New Tab: O(1)', explain: 'Opened a blank tab with its own empty history list.' };
        }

        switchTab(id) {
            if (!this.tabs.switchTo(id)) return { ok: false };
            return { ok: true, op: 'Switch Tab: O(1)', explain: 'Each tab has its own history list, so the chain below changed to this tab’s pages.' };
        }

        closeTab(id) {
            const result = this.tabs.close(id, this.clock());
            if (!result) return { ok: false };
            const pages = result.tab.history.size;
            return {
                ok: true, tab: result.tab, op: 'Close Tab (Push): O(1)',
                explain: 'Pushed “' + result.tab.title + '” onto the top of the stack together with its ' +
                    pages + (pages === 1 ? ' page' : ' pages') + ' of history.'
            };
        }

        reopenTab() {
            const tab = this.tabs.reopen();
            if (!tab) return { ok: false };
            const pages = tab.history.size;
            return {
                ok: true, tab, op: 'Reopen Tab (Pop): O(1)',
                explain: 'Popped “' + tab.title + '” off the top of the stack (last closed, first reopened) with its ' +
                    pages + (pages === 1 ? ' page' : ' pages') + ' of history.'
            };
        }

        // ---- downloads (queue) ---------------------------------------------

        enqueueDownload() {
            const node = this.current;
            if (!node) return { ok: false };
            this.downloads.enqueue({ name: hostOf(node.url), url: node.url, time: this.clock() });
            return {
                ok: true, op: 'Download Enqueue: O(1)',
                explain: 'Added ' + hostOf(node.url) + ' to the back of the line. ' + this.downloads.size() + ' waiting.'
            };
        }

        processDownload() {
            const item = this.downloads.dequeue();
            if (!item) return { ok: false };
            this.completed.unshift({ name: item.name, doneAt: this.clock() });
            if (this.completed.length > MAX_COMPLETED) this.completed.pop();
            return {
                ok: true, op: 'Download Dequeue: O(1)',
                explain: 'Finished ' + item.name + ' — the oldest download leaves the front of the line first.'
            };
        }

        // ---- bookmarks (tree) --------------------------------------------------

        isBookmarked() {
            return !!(this.current && this.bookmarks.findByUrl(this.current.url));
        }

        /** Adds the current page to the selected folder, or removes it if it is already bookmarked. */
        toggleBookmark() {
            const node = this.current;
            if (!node) return { ok: false };
            const existing = this.bookmarks.findByUrl(node.url);
            if (existing) {
                this.bookmarks.remove(existing.id);
                return { ok: true, added: false, op: 'Remove Bookmark: O(n)', explain: 'Searched the tree for ' + hostOf(node.url) + ' and detached it from its folder.' };
            }
            const target = this.bookmarks.find(this.bookmarkTargetId) || this.bookmarks.favorites;
            this.bookmarks.addBookmark(target.id, shortUrl(node.url), node.url);
            return { ok: true, added: true, op: 'Add Bookmark: O(n)', explain: 'Added ' + hostOf(node.url) + ' as a child of the “' + target.name + '” folder (the search for duplicates is the O(n) part).' };
        }

        addFolder(name) {
            const clean = String(name == null ? '' : name).trim().slice(0, MAX_FIELD_LENGTH);
            if (!clean) return { ok: false, error: 'empty' };
            const target = this.bookmarks.find(this.bookmarkTargetId) || this.bookmarks.favorites;
            const folder = this.bookmarks.addFolder(target.id, clean);
            if (!folder) return { ok: false };
            return { ok: true, op: 'Add Folder: O(n)', explain: 'Created folder “' + clean + '” inside “' + target.name + '”. Trees nest as deep as you like.' };
        }

        removeBookmarkNode(id) {
            if (!this.bookmarks.remove(id)) return { ok: false };
            if (!this.bookmarks.find(this.bookmarkTargetId)) this.bookmarkTargetId = this.bookmarks.favorites.id;
            return { ok: true, op: 'Remove Node: O(n)', explain: 'Detached that node and everything inside it from the tree.' };
        }

        selectBookmarkFolder(id) {
            const node = this.bookmarks.find(id);
            if (!node || !node.isFolder) return false;
            this.bookmarkTargetId = id;
            return true;
        }

        // ---- saving -----------------------------------------------------------

        toJSON() {
            return {
                tabs: this.tabs.toJSON(),
                downloads: this.downloads.toArray(),
                completed: this.completed,
                domains: this.domains.values(),
                bookmarks: this.bookmarks.toJSON(),
                bookmarkTargetId: this.bookmarkTargetId
            };
        }

        static fromJSON(data, options) {
            const browser = new Browser(options);
            if (!data || typeof data !== 'object') return browser;
            browser.tabs = TabManager.fromJSON(data.tabs);
            (Array.isArray(data.downloads) ? data.downloads : []).forEach(d => {
                if (d && typeof d.name === 'string' && isSafeUrl(d.url)) {
                    browser.downloads.enqueue({ name: d.name, url: d.url, time: String(d.time || '') });
                }
            });
            browser.completed = (Array.isArray(data.completed) ? data.completed : [])
                .filter(c => c && typeof c.name === 'string')
                .slice(0, MAX_COMPLETED)
                .map(c => ({ name: c.name, doneAt: String(c.doneAt || '') }));
            (Array.isArray(data.domains) ? data.domains : []).forEach(d => { if (typeof d === 'string') browser.domains.add(d); });
            browser.bookmarks = BookmarkTree.fromJSON(data.bookmarks);
            browser.bookmarkTargetId = browser.bookmarks.find(data.bookmarkTargetId)
                ? data.bookmarkTargetId : browser.bookmarks.favorites.id;
            return browser;
        }
    }

    return {
        MAX_URL_LENGTH, HOME_URL,
        isSafeUrl, hostOf, shortUrl, normalizeInput,
        HistoryNode, HistoryList, TabStack, DownloadQueue, DomainSet,
        BookmarkNode, BookmarkTree, Tab, TabManager, Browser
    };
});
