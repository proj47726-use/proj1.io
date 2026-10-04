# Smart Browser System – DSA Engine

A small browser simulation that solves a classic data-structures problem and lets you **watch the data structures work** while you click around.

## The problem

> A browser must let users move backward and forward through visited pages, but also support opening a new page mid-history (which should discard "forward" history). Build a system that manages this navigation efficiently.

## The solution in one picture

History is a **doubly linked list**: a chain of pages where every page points to the one before it and the one after it. One marker, `CURRENT`, says where you are.

```
HEAD → [google.com] ⇄ [youtube.com] ⇄ [github.com] ⇄ [wikipedia.org]
                                          ↑
                                       CURRENT
```

| You do… | What happens | Cost |
|---|---|---|
| **Back** | `CURRENT` moves one node left | O(1) |
| **Forward** | `CURRENT` moves one node right | O(1) |
| **Visit a new page** | New node is attached after `CURRENT`; its `next` link replaces the old one, so the pages to the right are cut off | O(1) |
| **Click a page in the history list** | `CURRENT` walks along the chain to it | O(k), k = nodes walked |

**Why visiting is truly O(1).** The list remembers its `size` and the `position` of `CURRENT`, so it already knows how many pages are being thrown away (`size - position`). It never has to walk them. Cutting them off is a single pointer change, and the garbage collector frees the orphaned nodes. (The original version walked every forward page just to count them, which made it O(k) while claiming O(1).)

*One honest footnote:* the dashboard's "just discarded" animation needs the list of discarded pages, so the page walks the forward pages once to show them. That walk is only for display; the history operation itself stays O(1).

## All the data structures

| Feature | Structure | Why it fits | Cost |
|---|---|---|---|
| Browser history (one list per tab) | **Doubly linked list** | Fast Back/Forward, trivial truncation | visit / back / forward O(1), jump O(k) |
| Recently closed tabs | **Stack** (LIFO) | Last closed is first reopened | push / pop O(1) |
| Download manager | **Queue** (FIFO, linked list with head + tail) | Downloads finish in the order they started | enqueue / dequeue O(1) |
| Unique domains visited | **Set** | Stores each site once | add / has O(1) average |
| Bookmarks | **N-ary tree** | Folders hold folders and links | add and remove O(n) (finding the folder and checking for duplicates means searching the tree) |

## How to run

You need nothing installed to try the frontend.

**Frontend only (no Java, works offline)**
Open `frontend/index.html` in any modern browser. The badge in the dashboard will say *Backend: offline (local mode)*, and everything still works.

**With the Java backend** (needs Java 17+ and Maven)
```bash
mvn spring-boot:run
```
Then open `frontend/index.html`. The badge turns green: *Backend: in sync*.

**Run the tests**
```bash
mvn test                # Java: linked list + stack
npm test                # JavaScript: all data structures and browser logic (Node 18+)
npm install && npm run test:ui   # optional: clicks through the real page in a simulated browser (Node 20+)
```

## Try this first

1. Open the page, and click the **DSA dashboard** button if it is not already open.
2. Visit three sites (the welcome page has shortcuts).
3. Press **←** twice.
4. Type a new address and press **Go**.
5. Watch the rail: the two forward pages turn red and fade out, and the dark announcement board at the top explains what happened in plain English.

Then try: close a tab and reopen it (its history comes back), add a download and process it, bookmark a page, make a folder, click a page in the history chain to jump to it, and refresh the browser tab (everything is saved).

## The look: history as a metro line

Most dashboards for projects like this are dark with purple accents. This one is deliberately different, and the look comes straight from the subject: browsing history *is* a line of stops.

- **Stations on a rail.** Every page in the history is a station. The green rail is the part you have visited, and the yellow **You are here** marker is `CURRENT`.
- **Forward pages are a dashed grey track.** After you press Back, the pages ahead of you are drawn as an unfinished, greyed-out track. Open a new page and that track is cut: the old stations turn red, are struck through, and fade away.
- **One colour per data structure**, like the lines on a transit map: green for history, red for closed tabs, blue for downloads, amber for domains, magenta for bookmarks. The same colour marks the section header and its items.
- **A signage-style announcement board** at the top of the dashboard says what your last action did (for example `Visit: O(1)`). It stays pinned while you scroll, so you never miss it.
- **Type:** Archivo (a signage-style sans) for text and IBM Plex Mono for web addresses and complexities. Both are bundled in `frontend/fonts/`, so nothing loads from the internet.
- The colours are defined once at the top of `style.css` (`:root`), so changing the whole palette takes a minute.

Both fonts are licensed under the SIL Open Font License 1.1 (copies are in `frontend/fonts/`).

## How the frontend and backend relate

The frontend runs the whole system by itself, so it works with or without Java. The Java backend is an independent implementation of the same lists. After every action the page sends it the action and compares the backend's answer with its own state:

- **Same answer** → badge shows *in sync*.
- **Different answer** (for example you restarted the backend) → the page automatically wipes the backend's copy and replays its own state to it.
- **No answer** → badge shows *offline*, and the page carries on in local mode.

Each browser window has its own `clientId`, and each tab its own `tabId`, so several people can use the same backend without seeing each other's history.

## API (Java backend)

Every endpoint is a `POST` (except `state`) and takes `clientId` and `tabId` (letters, digits, `-`, `_`; up to 64 characters). Both default to `anonymous` / `1`.

| Method | Endpoint | Extra parameters | What it does |
|---|---|---|---|
| POST | `/api/history/visit` | `url` (http/https, ≤ 2048 chars) | Visit a page, discard forward history |
| POST | `/api/history/back` | | Go back |
| POST | `/api/history/forward` | | Go forward |
| POST | `/api/history/jump` | `position` (1-based) | Jump to a page |
| POST | `/api/history/clear` | | Clear this tab's history |
| GET | `/api/history/state` | | Read this tab's current state |
| POST | `/api/tabs/close` | `title` | Push the tab onto the closed-tab stack |
| POST | `/api/tabs/reopen` | | Pop the most recently closed tab |
| POST | `/api/session/reset` | | Delete everything stored for this client |

Bad input gets a `400` with a clear message. Example:
```bash
curl -X POST "http://localhost:8080/api/history/visit?clientId=demo&url=https://github.com"
```

## Project layout

```
pom.xml                      Maven build (Spring Boot 3.1, Java 17)
src/main/java/com/browser/dsa/
  ds/                        CustomDoublyLinkedList, CustomStack   ← the data structures
  model/                     HistoryNode, TabNode, HistorySnapshot
  service/                   BrowserStateService (per-client, per-tab state)
  controller/                History, Tab, Session endpoints + input checks
src/test/java/…              JUnit tests for the list and the stack
frontend/
  index.html  style.css      the page
  engine.js                  every data structure + all browser logic (no screen code)
  app.js                     draws the page, saves state, talks to the backend
  engine.test.js             41 tests for engine.js (run with Node)
  fonts/                     Archivo + IBM Plex Mono (bundled so it works offline) and their licences
tests/ui.test.js             16 click-through tests of the real page
```

## What was improved from the first version

**The core problem**
- Visit is now genuinely O(1) (it used to walk all forward pages).
- Click any page in the history to jump to it.
- Discarded pages are shown fading out, and a plain-English explanation appears after every action.

**Bugs fixed**
- `pom.xml` had `<n>` instead of `<name>`, which stops Maven from building at all.
- Tabs are real: each has its own history, you can switch between them, and reopening a closed tab brings back its full history (before, only the title came back).
- Clear History now also clears the domain set.
- Bookmarks can no longer be duplicated, and they can be removed. Folders can be created and chosen as the target.
- Download "Process next" now moves the item into a visible *finished* list.
- Reload no longer does nothing: it counts reloads without adding to history, like a real browser.
- The download queue used `Array.shift()`, which is not guaranteed O(1); it is now a linked queue with head and tail pointers.
- Addresses like `localhost:3000` and IP addresses work instead of becoming searches.

**Security**
- Page content is built with text nodes only, never HTML strings, so a URL or a bookmark name cannot inject code (the original used `innerHTML` with user text).
- Only `http` and `https` links are accepted anywhere: the address bar, saved data, and the Java API.
- The backend validates every parameter and returns `400` for bad input.

**Backend**
- State is per client and per tab instead of one global list for everybody.
- The frontend now checks the backend's answers and repairs the backend if it drifts.
- Thread-safe snapshots, so a request can never read a half-changed list.

**Quality of life**
- Everything is saved in the browser (`localStorage`), so a refresh keeps your tabs, history, bookmarks and downloads. **Reset everything** wipes it.
- Keyboard and screen-reader support (labelled buttons, visible focus, proper tab roles), and reduced-motion is respected.
- Unit tests for the Java structures and the JavaScript engine, plus end-to-end page tests.

## Known limitations

- The viewport shows a *simulated* page. Real sites mostly refuse to load inside another page, so the project shows the data structures instead of site content.
- Backend state is in memory only (it resets when the server restarts; the page then repairs it automatically) and keeps at most 500 clients.
- CORS is open (`*`) so the page works from a `file://` address. Restrict it before putting this anywhere public.

## Questions you might be asked (and short answers)

**Why a doubly linked list and not an array?** An array makes Back/Forward easy but truncating history means deleting a range, and inserting in the middle is O(n). A linked list cuts the forward pages with one pointer change.

**Why doubly and not singly linked?** Back needs the previous node. With a singly linked list you would have to search from the head each time, which is O(n).

**Why is visit O(1) if you "delete" the forward pages?** We never delete them one by one. We change one pointer, and the garbage collector reclaims the unreachable nodes. We track `size` and `position`, so we know the new size without counting.

**Why is jump O(k)?** A linked list has no random access. To reach page 5 from page 2, you must follow 3 links.

**Why a stack for closed tabs?** The tab you closed last is the one you most likely want back, which is exactly last-in-first-out.

**Why a queue for downloads?** Fairness: the earliest request finishes first, which is first-in-first-out. Using head and tail pointers keeps both ends O(1).

**What would you add next?** A size limit on history (drop the oldest node by moving `head`), tests for the controllers with Spring's `MockMvc`, and real persistence in the backend with a database.
