// Run with:  node --test frontend/engine.test.js   (or: npm test)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./engine.js');

const urls = list => list.toArray().map(n => n.url);
const makeList = (...pages) => {
    const list = new E.HistoryList();
    pages.forEach(p => list.visit(p, '10:00'));
    return list;
};
const makeBrowser = () => new E.Browser({ clock: () => '10:00:00' });

// ---------------------------------------------------------------------------
// The core problem: back / forward / visit-in-the-middle
// ---------------------------------------------------------------------------

test('first visit becomes head and current', () => {
    const list = makeList('a');
    assert.equal(list.head, list.current);
    assert.equal(list.size, 1);
    assert.equal(list.position, 1);
});

test('back and forward move current without deleting anything', () => {
    const list = makeList('a', 'b', 'c');
    assert.equal(list.back(), true);
    assert.equal(list.current.url, 'b');
    assert.equal(list.back(), true);
    assert.equal(list.current.url, 'a');
    assert.equal(list.forward(), true);
    assert.equal(list.current.url, 'b');
    assert.equal(list.size, 3);
    assert.equal(list.position, 2);
});

test('back stops at the first page and forward stops at the last', () => {
    const list = makeList('a', 'b');
    assert.equal(list.forward(), false);
    list.back();
    assert.equal(list.back(), false);
    assert.equal(list.current.url, 'a');
});

test('visiting in the middle discards the forward pages', () => {
    const list = makeList('a', 'b', 'c', 'd');
    list.back();
    list.back();                                  // on b
    const { discarded } = list.visit('x', '10:01');
    assert.equal(discarded, 2);                   // c and d
    assert.deepEqual(urls(list), ['a', 'b', 'x']);
    assert.equal(list.size, 3);
    assert.equal(list.position, 3);
    assert.equal(list.canGoForward(), false);
});

test('visit reports 0 discarded when already at the end', () => {
    const list = makeList('a', 'b');
    assert.equal(list.visit('c', 't').discarded, 0);
});

test('size and position stay right after repeated branching', () => {
    const list = makeList('a', 'b', 'c');
    list.back();
    list.visit('d');              // a b d
    list.back();
    list.back();
    list.visit('e');              // a e
    assert.deepEqual(urls(list), ['a', 'e']);
    assert.equal(list.size, 2);
});

test('prev links stay consistent along the whole chain', () => {
    const list = makeList('a', 'b', 'c', 'd');
    list.back();
    list.visit('x');
    for (let n = list.head; n.next; n = n.next) assert.equal(n.next.prev, n);
});

test('jumpTo moves to any page and reports the steps taken', () => {
    const list = makeList('a', 'b', 'c', 'd');
    assert.equal(list.jumpTo(1), 3);
    assert.equal(list.current.url, 'a');
    assert.equal(list.jumpTo(3), 2);
    assert.equal(list.current.url, 'c');
    assert.equal(list.jumpTo(3), 0);
});

test('jumpTo rejects invalid positions and changes nothing', () => {
    const list = makeList('a', 'b');
    for (const bad of [0, 3, -1, 1.5, NaN, '1']) assert.equal(list.jumpTo(bad), -1);
    assert.equal(list.position, 2);
});

test('clear empties the list and it can be reused', () => {
    const list = makeList('a', 'b');
    list.clear();
    assert.equal(list.head, null);
    assert.equal(list.size, 0);
    list.visit('z', 't');
    assert.equal(list.size, 1);
});

test('forwardNodes lists exactly what a visit would discard', () => {
    const list = makeList('a', 'b', 'c', 'd');
    list.jumpTo(2);
    assert.deepEqual(list.forwardNodes().map(n => n.url), ['c', 'd']);
});

test('history survives a save and load, including the current position', () => {
    const list = makeList('https://a.com/', 'https://b.com/', 'https://c.com/');
    list.back();
    const copy = E.HistoryList.fromJSON(JSON.parse(JSON.stringify(list.toJSON())));
    assert.deepEqual(urls(copy), urls(list));
    assert.equal(copy.position, 2);
    assert.equal(copy.size, 3);
});

test('loading history drops entries that are not http(s) links', () => {
    const copy = E.HistoryList.fromJSON({
        nodes: [{ url: 'https://ok.com/' }, { url: 'javascript:alert(1)' }, { url: 'https://also-ok.com/' }],
        position: 3
    });
    assert.deepEqual(urls(copy), ['https://ok.com/', 'https://also-ok.com/']);
    assert.equal(copy.position, 2);
});

// ---------------------------------------------------------------------------
// Address bar input
// ---------------------------------------------------------------------------

test('normalizeInput adds https to bare domains', () => {
    assert.equal(E.normalizeInput('github.com').url, 'https://github.com/');
    assert.equal(E.normalizeInput('  github.com/user/repo ').url, 'https://github.com/user/repo');
});

test('normalizeInput understands localhost and IP addresses', () => {
    assert.equal(E.normalizeInput('localhost:3000').url, 'http://localhost:3000/');
    assert.equal(E.normalizeInput('192.168.1.1').url, 'https://192.168.1.1/');
});

test('normalizeInput keeps full http(s) URLs', () => {
    assert.equal(E.normalizeInput('http://example.com/a').url, 'http://example.com/a');
});

test('normalizeInput turns plain words into a search', () => {
    const r = E.normalizeInput('best pizza near me');
    assert.equal(r.isSearch, true);
    assert.equal(r.url, 'https://www.google.com/search?q=best%20pizza%20near%20me');
});

test('normalizeInput never lets javascript: or file: through', () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>']) {
        const r = E.normalizeInput(bad);
        assert.equal(r.isSearch, true, bad);
        assert.match(r.url, /^https:\/\/www\.google\.com\/search\?q=/);
    }
});

test('normalizeInput rejects empty and oversized input', () => {
    assert.equal(E.normalizeInput('   ').error, 'empty');
    assert.equal(E.normalizeInput('').error, 'empty');
    assert.equal(E.normalizeInput(null).error, 'empty');
    assert.equal(E.normalizeInput('x'.repeat(3000)).error, 'too-long');
});

// ---------------------------------------------------------------------------
// Stack, queue, set
// ---------------------------------------------------------------------------

test('stack pops in last-in-first-out order', () => {
    const s = new E.TabStack();
    s.push(1); s.push(2); s.push(3);
    assert.equal(s.peek(), 3);
    assert.deepEqual([s.pop(), s.pop(), s.pop(), s.pop()], [3, 2, 1, null]);
    assert.equal(s.isEmpty(), true);
});

test('queue serves first-in-first-out and handles emptying and refilling', () => {
    const q = new E.DownloadQueue();
    assert.equal(q.dequeue(), null);
    q.enqueue('a'); q.enqueue('b'); q.enqueue('c');
    assert.equal(q.peek(), 'a');
    assert.deepEqual(q.toArray(), ['a', 'b', 'c']);
    assert.equal(q.dequeue(), 'a');
    assert.equal(q.dequeue(), 'b');
    assert.equal(q.dequeue(), 'c');
    assert.equal(q.isEmpty(), true);
    q.enqueue('d');                                // tail must have been reset
    assert.deepEqual(q.toArray(), ['d']);
    assert.equal(q.size(), 1);
});

test('set stores each domain once', () => {
    const s = new E.DomainSet();
    assert.equal(s.add('a.com'), true);
    assert.equal(s.add('a.com'), false);
    s.add('b.com');
    assert.equal(s.size(), 2);
    s.clear();
    assert.equal(s.size(), 0);
});

test('bookmark tree nests folders, rejects duplicates and removes subtrees', () => {
    const tree = new E.BookmarkTree();
    const work = tree.addFolder(tree.favorites.id, 'Work');
    assert.ok(tree.addBookmark(work.id, 'gh', 'https://github.com/'));
    assert.equal(tree.addBookmark(tree.favorites.id, 'gh again', 'https://github.com/'), null);
    assert.equal(tree.countBookmarks(), 1);
    assert.equal(tree.remove(work.id), true);        // takes the bookmark with it
    assert.equal(tree.countBookmarks(), 0);
    assert.equal(tree.remove(tree.root.id), false);  // root is protected
});

test('bookmarks cannot be added inside a bookmark', () => {
    const tree = new E.BookmarkTree();
    const link = tree.addBookmark(tree.favorites.id, 'a', 'https://a.com/');
    assert.equal(tree.addFolder(link.id, 'nope'), null);
    assert.equal(tree.addBookmark(link.id, 'b', 'https://b.com/'), null);
});

test('bookmark tree survives save/load and ignores unsafe links', () => {
    const tree = new E.BookmarkTree();
    tree.addBookmark(tree.favorites.id, 'ok', 'https://ok.com/');
    const data = JSON.parse(JSON.stringify(tree.toJSON()));
    data.root.children[0].children.push({ id: 99, name: 'evil', isFolder: false, url: 'javascript:alert(1)', children: [] });
    const copy = E.BookmarkTree.fromJSON(data);
    assert.equal(copy.countBookmarks(), 1);
    assert.equal(copy.favorites.name, 'Favorites');
    assert.ok(copy.addFolder(0, 'new').id > 99 || copy.nextId > 1);
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

test('every tab has its own independent history', () => {
    const b = makeBrowser();
    b.navigate('a.com');
    b.newTab();
    assert.equal(b.current, null);
    b.navigate('b.com');
    assert.equal(b.history.size, 1);
    b.switchTab(1);
    assert.equal(b.current.url, 'https://a.com/');
});

test('closing a tab pushes it with its history, and reopening restores that history', () => {
    const b = makeBrowser();
    b.navigate('a.com');
    b.navigate('b.com');
    b.back();
    b.newTab();
    b.closeTab(1);
    assert.equal(b.tabs.closed.size(), 1);
    assert.equal(b.tabs.tabs.length, 1);
    const r = b.reopenTab();
    assert.equal(r.ok, true);
    assert.equal(b.tabs.activeId, 1);
    assert.equal(b.history.size, 2);
    assert.equal(b.history.position, 1);
    assert.equal(b.current.url, 'https://a.com/');
});

test('closed tabs reopen most-recent-first', () => {
    const b = makeBrowser();
    b.newTab(); b.newTab();                       // tabs 1, 2, 3
    b.closeTab(2);
    b.closeTab(3);
    assert.equal(b.reopenTab().tab.id, 3);
    assert.equal(b.reopenTab().tab.id, 2);
    assert.equal(b.reopenTab().ok, false);
});

test('closing the active tab activates a neighbour; closing the last tab opens a blank one', () => {
    const b = makeBrowser();
    b.newTab();                                   // tabs 1, 2 — 2 active
    b.closeTab(2);
    assert.equal(b.tabs.activeId, 1);
    b.closeTab(1);
    assert.equal(b.tabs.tabs.length, 1);
    assert.notEqual(b.tabs.activeId, 1);
    assert.equal(b.current, null);
});

test('reopened tab ids never collide with new tabs', () => {
    const b = makeBrowser();
    b.closeTab(1);                                // replacement tab 2 opens
    b.newTab();                                   // tab 3
    b.reopenTab();                                // tab 1 comes back
    const ids = b.tabs.tabs.map(t => t.id);
    assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// Browser actions
// ---------------------------------------------------------------------------

test('navigate adds each domain to the set only once', () => {
    const b = makeBrowser();
    b.navigate('a.com');
    b.navigate('a.com/other');
    b.navigate('b.com');
    assert.equal(b.domains.size(), 2);
    assert.deepEqual(b.domains.values(), ['a.com', 'b.com']);
});

test('navigate reports which pages it discarded', () => {
    const b = makeBrowser();
    ['a.com', 'b.com', 'c.com'].forEach(u => b.navigate(u));
    b.back(); b.back();
    const r = b.navigate('x.com');
    assert.deepEqual(r.discardedUrls, ['https://b.com/', 'https://c.com/']);
    assert.equal(r.discarded, 2);
});

test('navigate refuses empty input without touching history', () => {
    const b = makeBrowser();
    assert.equal(b.navigate('  ').ok, false);
    assert.equal(b.history.size, 0);
});

test('reload never changes the history chain', () => {
    const b = makeBrowser();
    b.navigate('a.com');
    b.reload(); b.reload();
    assert.equal(b.history.size, 1);
    assert.equal(b.current.reloads, 2);
    assert.equal(makeBrowser().reload().ok, false);
});

test('clear history empties every tab and the domain set, but keeps bookmarks', () => {
    const b = makeBrowser();
    b.navigate('a.com');
    b.toggleBookmark();
    b.newTab();
    b.navigate('b.com');
    b.clearHistory();
    assert.equal(b.tabs.tabs.every(t => t.history.size === 0), true);
    assert.equal(b.domains.size(), 0);
    assert.equal(b.bookmarks.countBookmarks(), 1);
});

test('downloads are processed oldest first and finished ones are logged', () => {
    const b = makeBrowser();
    b.navigate('a.com'); b.enqueueDownload();
    b.navigate('b.com'); b.enqueueDownload();
    assert.equal(b.processDownload().ok, true);
    assert.equal(b.downloads.size(), 1);
    assert.equal(b.completed[0].name, 'a.com');
    b.processDownload();
    assert.equal(b.processDownload().ok, false);
    assert.equal(b.completed.length, 2);
});

test('download needs a page to download', () => {
    assert.equal(makeBrowser().enqueueDownload().ok, false);
});

test('bookmark button toggles: add, then remove, with no duplicates', () => {
    const b = makeBrowser();
    b.navigate('a.com');
    assert.equal(b.toggleBookmark().added, true);
    assert.equal(b.isBookmarked(), true);
    assert.equal(b.bookmarks.countBookmarks(), 1);
    assert.equal(b.toggleBookmark().added, false);
    assert.equal(b.isBookmarked(), false);
    assert.equal(b.bookmarks.countBookmarks(), 0);
});

test('new bookmarks go into the selected folder; removing that folder resets the target', () => {
    const b = makeBrowser();
    b.navigate('a.com');
    b.addFolder('Reading');
    const reading = b.bookmarks.favorites.children[0];
    assert.equal(b.selectBookmarkFolder(reading.id), true);
    b.toggleBookmark();
    assert.equal(reading.children.length, 1);
    b.removeBookmarkNode(reading.id);
    assert.equal(b.bookmarkTargetId, b.bookmarks.favorites.id);
});

test('the whole browser survives a save and load', () => {
    const b = makeBrowser();
    b.navigate('a.com'); b.navigate('b.com'); b.back();
    b.enqueueDownload();
    b.toggleBookmark();
    b.newTab(); b.navigate('c.com');
    b.closeTab(2);
    const copy = E.Browser.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    assert.equal(copy.history.position, 1);
    assert.equal(copy.history.size, 2);
    assert.equal(copy.downloads.size(), 1);
    assert.equal(copy.bookmarks.countBookmarks(), 1);
    assert.equal(copy.tabs.closed.size(), 1);
    assert.equal(copy.domains.size(), b.domains.size());
    assert.equal(copy.reopenTab().tab.history.current.url, 'https://c.com/');
});

test('garbage saved data falls back to a working empty browser', () => {
    for (const junk of [null, 42, 'x', [], {}, { tabs: 5 }, { tabs: { tabs: 'no' } }]) {
        const b = E.Browser.fromJSON(junk);
        assert.equal(b.tabs.tabs.length >= 1, true);
        assert.equal(b.navigate('a.com').ok, true);
    }
});
