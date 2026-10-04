// End-to-end test of the real page (index.html + engine.js + app.js) in a simulated browser,
// with a fake Java backend. Needs jsdom:  npm install   then   npm run test:ui
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const path = require('path');
const DIR = path.join(__dirname, '..', 'frontend') + path.sep;
const E = require(DIR + 'engine.js');
const ENGINE_SRC = fs.readFileSync(DIR + 'engine.js', 'utf8');
const APP_SRC = fs.readFileSync(DIR + 'app.js', 'utf8');
const HTML = fs.readFileSync(DIR + 'index.html', 'utf8').replace(/<script src[^>]*><\/script>/g, '');
const wait = ms => new Promise(r => setTimeout(r, ms));

// A stand-in for the Java backend that follows the same rules as the controllers.
function makeBackend() {
    const clients = new Map();
    const ID = /^[A-Za-z0-9_-]{1,64}$/;
    const backend = { online: true, calls: [], clients };
    const client = id => {
        if (!clients.has(id)) clients.set(id, { histories: new Map(), closed: [] });
        return clients.get(id);
    };
    const snap = l => ({
        totalNodes: l.size, position: l.position, currentUrl: l.current ? l.current.url : null,
        hasPrev: l.canGoBack(), hasNext: l.canGoForward(), urls: l.toArray().map(n => n.url)
    });
    backend.fetch = async (rawUrl, opts) => {
        if (!backend.online) throw new TypeError('Failed to fetch');
        const u = new URL(rawUrl);
        const path = u.pathname.replace('/api', '');
        const p = u.searchParams;
        const method = (opts && opts.method) || 'GET';
        backend.calls.push(method + ' ' + path);
        const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
        const clientId = p.get('clientId') || 'anonymous';
        const tabId = p.get('tabId') || '1';
        if (!ID.test(clientId) || !ID.test(tabId)) return reply(400, {});
        const c = client(clientId);
        const hist = () => { if (!c.histories.has(tabId)) c.histories.set(tabId, new E.HistoryList()); return c.histories.get(tabId); };
        switch (path) {
            case '/history/visit': {
                const url = p.get('url');
                if (!/^https?:\/\//i.test(url || '') || url.length > 2048) return reply(400, {});
                hist().visit(url, 't'); return reply(200, snap(hist()));
            }
            case '/history/back': hist().back(); return reply(200, snap(hist()));
            case '/history/forward': hist().forward(); return reply(200, snap(hist()));
            case '/history/jump':
                if (hist().jumpTo(Number(p.get('position'))) < 0) return reply(400, {});
                return reply(200, snap(hist()));
            case '/history/clear': hist().clear(); return reply(200, snap(hist()));
            case '/history/state': return reply(200, snap(hist()));
            case '/tabs/close': c.closed.push({ tabId, title: p.get('title') }); return reply(200, { stackSize: c.closed.length });
            case '/tabs/reopen': { const t = c.closed.pop(); return reply(200, { restoredTabId: t ? t.tabId : null, stackSize: c.closed.length }); }
            case '/session/reset': clients.delete(clientId); return reply(200, { ok: true });
            default: return reply(404, {});
        }
    };
    return backend;
}

async function boot(backend, storage) {
    const dom = new JSDOM(HTML, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    await wait(20);                                   // let the natural load events finish first
    w.fetch = backend.fetch;
    w.matchMedia = () => ({ matches: true });
    w.confirm = () => true;
    Object.entries(storage || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
    w.eval(ENGINE_SRC);
    w.eval(APP_SRC);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    await wait(60);
    const d = w.document;
    const ui = {
        w, d,
        $: id => d.getElementById(id),
        click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })),
        submit: form => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })),
        go: async text => { ui.$('address-bar').value = text; ui.submit(ui.$('address-form')); await wait(40); },
        nodes: () => Array.from(d.querySelectorAll('#history-visualizer button.node')),
        ghosts: () => d.querySelectorAll('#history-visualizer .node.ghost').length,
        badge: () => ui.$('sync-badge').dataset.state,
        tabs: () => Array.from(d.querySelectorAll('.tab-title')).map(b => b.textContent),
        storage: () => Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => [w.localStorage.key(i), w.localStorage.getItem(w.localStorage.key(i))]))
    };
    return ui;
}

test('empty start: welcome card, disabled buttons, backend in sync', async () => {
    const ui = await boot(makeBackend());
    assert.ok(ui.d.querySelector('.welcome-card'));
    assert.equal(ui.$('back-btn').disabled, true);
    assert.equal(ui.$('forward-btn').disabled, true);
    assert.equal(ui.$('download-btn').disabled, true);
    assert.equal(ui.$('reopen-tab-btn').disabled, true);
    assert.equal(ui.badge(), 'synced');
    assert.equal(ui.$('dsa-dashboard').classList.contains('hidden'), false);
});

test('the core problem: back twice, visit new page, forward pages are discarded (UI + backend)', async () => {
    const backend = makeBackend();
    const ui = await boot(backend);
    await ui.go('a.com'); await ui.go('b.com'); await ui.go('c.com');
    assert.equal(ui.nodes().length, 3);
    ui.click(ui.$('back-btn')); await wait(30);
    ui.click(ui.$('back-btn')); await wait(30);
    assert.equal(ui.$('address-bar').value, 'https://a.com/');
    assert.equal(ui.$('back-btn').disabled, true);
    assert.equal(ui.$('forward-btn').disabled, false);

    await ui.go('x.com');
    assert.equal(ui.nodes().length, 2, 'a and x remain');
    assert.equal(ui.$('forward-btn').disabled, true);
    assert.equal(ui.ghosts(), 2, 'b and c shown as discarded');
    assert.match(ui.$('whats-new').textContent, /cut the link to 2 forward pages/);
    assert.equal(ui.badge(), 'synced');

    const id = JSON.parse(ui.storage()['smart-browser-dsa:v2']).clientId;
    const urls = backend.clients.get(id).histories.get('1').toArray().map(n => n.url);
    assert.deepEqual(urls, ['https://a.com/', 'https://x.com/']);

    await wait(2500);
    assert.equal(ui.ghosts(), 0, 'ghosts remove themselves');
});

test('clicking a history node jumps to it', async () => {
    const ui = await boot(makeBackend());
    await ui.go('a.com'); await ui.go('b.com'); await ui.go('c.com');
    ui.click(ui.nodes()[0]); await wait(40);
    assert.equal(ui.$('address-bar').value, 'https://a.com/');
    assert.match(ui.$('stat-complexity').textContent, /Jump: O\(k\), k = 2/);
    assert.equal(ui.badge(), 'synced');
});

test('plain words search; empty input only shows a toast', async () => {
    const ui = await boot(makeBackend());
    await ui.go('best pizza');
    assert.match(ui.$('address-bar').value, /google\.com\/search\?q=best%20pizza/);
    assert.match(ui.$('whats-new').textContent, /searched on Google/);
    await ui.go('   ');
    assert.equal(ui.$('toast').hidden, false);
    assert.equal(ui.nodes().length, 1);
});

test('text from bookmark names and URLs is never turned into HTML', async () => {
    const ui = await boot(makeBackend());
    await ui.go('a.com');
    ui.$('folder-name').value = '<img src=x onerror="window.__pwned=1">';
    ui.submit(ui.$('folder-form')); await wait(30);
    assert.equal(ui.d.querySelectorAll('img').length, 0);
    assert.equal(ui.d.querySelectorAll('#viewport script, aside script').length, 0);
    assert.equal(ui.w.__pwned, undefined);
    assert.match(ui.$('bookmark-visualizer').textContent, /<img src=x/);   // shown as plain text
    await ui.go('javascript:alert(1)');
    assert.match(ui.$('address-bar').value, /^https:\/\/www\.google\.com\/search/);
});

test('tabs are real: separate histories, switching, closing, reopening with history', async () => {
    const backend = makeBackend();
    const ui = await boot(backend);
    await ui.go('a.com'); await ui.go('b.com');
    ui.click(ui.$('new-tab-btn')); await wait(30);
    assert.deepEqual(ui.tabs(), ['b.com', 'New Tab']);
    assert.ok(ui.d.querySelector('.welcome-card'));
    await ui.go('c.com');
    assert.equal(ui.nodes().length, 1, 'new tab has its own history');

    ui.click(ui.d.querySelector('.tab-title[title="b.com"]')); await wait(30);
    assert.equal(ui.$('address-bar').value, 'https://b.com/');
    assert.equal(ui.nodes().length, 2);

    const closeBtn = ui.d.querySelector('.tab-close[aria-label="Close tab c.com"]');
    ui.click(closeBtn); await wait(40);
    assert.deepEqual(ui.tabs(), ['b.com']);
    assert.equal(ui.$('reopen-tab-btn').disabled, false);
    assert.equal(ui.$('reopen-count').textContent, '1');
    assert.match(ui.$('stack-visualizer').textContent, /TOP/);
    assert.equal(ui.badge(), 'synced');

    ui.click(ui.$('reopen-tab-btn')); await wait(40);
    assert.deepEqual(ui.tabs(), ['b.com', 'c.com']);
    assert.equal(ui.$('address-bar').value, 'https://c.com/');
    assert.equal(ui.$('reopen-tab-btn').disabled, true);
    assert.equal(ui.badge(), 'synced');
});

test('closing the only tab leaves a fresh blank tab', async () => {
    const ui = await boot(makeBackend());
    await ui.go('a.com');
    ui.click(ui.d.querySelector('.tab-close')); await wait(40);
    assert.deepEqual(ui.tabs(), ['New Tab']);
    assert.ok(ui.d.querySelector('.welcome-card'));
    ui.click(ui.$('reopen-tab-btn')); await wait(40);
    assert.equal(ui.$('address-bar').value, 'https://a.com/');
});

test('download queue is first-in-first-out and logs finished downloads', async () => {
    const ui = await boot(makeBackend());
    await ui.go('a.com'); ui.click(ui.$('download-btn'));
    await ui.go('b.com'); ui.click(ui.$('download-btn'));
    assert.equal(ui.$('stat-queue').textContent, '2');
    ui.click(ui.$('process-download-btn'));
    assert.equal(ui.$('stat-queue').textContent, '1');
    assert.match(ui.$('completed-visualizer').textContent, /a\.com/);
    assert.match(ui.$('queue-visualizer').textContent, /b\.com/);
    ui.click(ui.$('process-download-btn'));
    assert.equal(ui.$('process-download-btn').disabled, true);
});

test('bookmarks: toggle star, folders, target folder, open and remove', async () => {
    const ui = await boot(makeBackend());
    await ui.go('a.com');
    ui.click(ui.$('bookmark-btn'));
    assert.equal(ui.$('bookmark-btn').getAttribute('aria-pressed'), 'true');
    assert.equal(ui.$('stat-bookmarks').textContent, '1');
    ui.click(ui.$('bookmark-btn'));
    assert.equal(ui.$('stat-bookmarks').textContent, '0');

    ui.$('folder-name').value = 'Reading';
    ui.submit(ui.$('folder-form'));
    const folderBtn = Array.from(ui.d.querySelectorAll('#bookmark-visualizer .tree-btn')).find(b => b.textContent.includes('Reading'));
    assert.ok(folderBtn);
    ui.click(folderBtn);
    ui.click(ui.$('bookmark-btn'));
    assert.match(ui.$('bookmark-visualizer').textContent, /saves into: Reading/);

    await ui.go('b.com');
    const open = Array.from(ui.d.querySelectorAll('#bookmark-visualizer .tree-btn')).find(b => b.textContent.includes('a.com'));
    ui.click(open); await wait(40);
    assert.equal(ui.$('address-bar').value, 'https://a.com/');

    const remove = ui.d.querySelector('.tree-remove[aria-label="Remove Reading"]');
    ui.click(remove);
    assert.equal(ui.$('stat-bookmarks').textContent, '0');
    assert.match(ui.$('bookmark-visualizer').textContent, /saves into: Favorites/);
});

test('clear history empties every tab and the domain set (after confirm)', async () => {
    const ui = await boot(makeBackend());
    await ui.go('a.com');
    ui.click(ui.$('new-tab-btn')); await ui.go('b.com');
    assert.equal(ui.$('stat-set').textContent, '2');
    ui.click(ui.$('clear-history-btn')); await wait(60);
    assert.equal(ui.$('stat-set').textContent, '0');
    assert.ok(ui.d.querySelector('.welcome-card'));
    assert.equal(ui.badge(), 'synced');
    ui.click(ui.$('tabs-list').querySelector('.tab-title')); await wait(30);
    assert.ok(ui.d.querySelector('.welcome-card'));
});

test('a refresh keeps everything (saved in localStorage) and stays in sync', async () => {
    const backend = makeBackend();
    const first = await boot(backend);
    await first.go('a.com'); await first.go('b.com'); await first.go('c.com');
    first.click(first.$('back-btn')); await wait(30);
    first.click(first.$('bookmark-btn'));
    first.click(first.$('new-tab-btn')); await wait(30);

    const second = await boot(backend, first.storage());
    assert.deepEqual(second.tabs(), ['b.com', 'New Tab']);
    second.click(second.d.querySelector('.tab-title[title="b.com"]')); await wait(30);
    assert.equal(second.nodes().length, 3);
    assert.equal(second.$('address-bar').value, 'https://b.com/');
    assert.equal(second.$('bookmark-btn').getAttribute('aria-pressed'), 'true');
    assert.equal(second.$('forward-btn').disabled, false);
    assert.equal(second.badge(), 'synced');
});

test('if the backend lost its state (restart), the page rebuilds it automatically', async () => {
    const backend = makeBackend();
    const first = await boot(backend);
    await first.go('a.com'); await first.go('b.com'); await first.go('c.com');
    first.click(first.$('back-btn')); await wait(30);
    first.click(first.$('new-tab-btn')); await wait(30);
    await first.go('z.com');
    first.click(first.d.querySelector('.tab-close[aria-label="Close tab z.com"]')); await wait(40);
    const saved = first.storage();

    const restarted = makeBackend();                       // brand-new, empty backend
    const second = await boot(restarted, saved);
    await wait(300);
    assert.equal(second.badge(), 'synced');
    const id = JSON.parse(saved['smart-browser-dsa:v2']).clientId;
    const state = restarted.clients.get(id);
    assert.ok(state, 'backend now has this client');
    const h1 = state.histories.get('1');
    assert.deepEqual(h1.toArray().map(n => n.url), ['https://a.com/', 'https://b.com/', 'https://c.com/']);
    assert.equal(h1.position, 2);
    assert.equal(state.closed.length, 1);
    assert.equal(state.closed[0].title, 'z.com');
    assert.equal(state.histories.get('2').size, 1, 'closed tab history was rebuilt too');
});

test('offline backend: the app keeps working in local mode, then recovers', async () => {
    const backend = makeBackend();
    backend.online = false;
    const ui = await boot(backend);
    assert.equal(ui.badge(), 'offline');
    await ui.go('a.com'); await ui.go('b.com');
    ui.click(ui.$('back-btn')); await wait(30);
    assert.equal(ui.$('address-bar').value, 'https://a.com/');
    assert.equal(ui.badge(), 'offline');

    backend.online = true;
    await ui.go('c.com'); await wait(300);
    assert.equal(ui.badge(), 'synced', 'mismatch detected, state replayed');
    const id = JSON.parse(ui.storage()['smart-browser-dsa:v2']).clientId;
    assert.deepEqual(backend.clients.get(id).histories.get('1').toArray().map(n => n.url),
        ['https://a.com/', 'https://c.com/']);
});

test('reset everything wipes page, storage and backend', async () => {
    const backend = makeBackend();
    const ui = await boot(backend);
    await ui.go('a.com');
    ui.click(ui.$('reset-all-btn')); await wait(60);
    assert.ok(ui.d.querySelector('.welcome-card'));
    assert.equal(ui.$('stat-set').textContent, '0');
    assert.equal(ui.badge(), 'synced');
    const id = JSON.parse(ui.storage()['smart-browser-dsa:v2']).clientId;
    assert.equal(backend.clients.has(id), false, 'backend copy was deleted');
    assert.equal(JSON.parse(ui.storage()['smart-browser-dsa:v2']).browser.domains.length, 0);
});

test('welcome chips start browsing and the reload button counts reloads without adding history', async () => {
    const ui = await boot(makeBackend());
    ui.click(ui.d.querySelector('.chip')); await wait(40);
    assert.equal(ui.nodes().length, 1);
    ui.click(ui.$('reload-btn')); ui.click(ui.$('reload-btn'));
    assert.equal(ui.nodes().length, 1);
    assert.match(ui.$('viewport').textContent, /Reloads:\s*2/);
});

test('corrupted saved data does not break startup', async () => {
    const ui = await boot(makeBackend(), { 'smart-browser-dsa:v2': '{not json' });
    assert.ok(ui.d.querySelector('.welcome-card'));
    await ui.go('a.com');
    assert.equal(ui.nodes().length, 1);
});
