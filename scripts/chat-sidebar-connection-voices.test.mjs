/**
 * §F2's ONE VOICE for connection state, as the sidebar's two list-pane
 * paragraphs keep it.
 *
 * WHAT THIS PINS. The UX review's duplicate-Retry finding: on a dead backend
 * the screen carried the pane's status strip AND the sidebar's list-pane
 * paragraph, each with a `Retry`, one fact stated twice - and §F2 asks for the
 * sidebar's foot line and list-pane paragraph to stand down while the strip
 * can speak. The treatment is the foot line's own: all three blocks read the
 * SAME shared predicate (`stripSpeaksConnection`), none carries `role="alert"`
 * (the strip owns the one live region), and the control says "Retry refresh"
 * rather than a second bare "Retry".
 *
 * AND THE PREDICATE IS TWO TERMS ON PURPOSE (agent review round 2, R11). The
 * first cut read the strip's COPY CONDITION alone (`serverHealth?.online ===
 * false`), and the copy condition is true on every route while the strip is
 * mounted only in the conversation pane - so `/settings` and its siblings went
 * silent about a dead server with no second voice to take over. The predicate
 * now carries the strip's own PRESENCE beside the copy condition
 * (`chat-status-presence.ts`), which the strip publishes while it is drawn, so
 * the sidebar yields exactly where a voice remains. That half is pinned here
 * too: the strip must publish, the sidebar must consume, and the pane's own
 * catalogue error - the surface the walker's before-run photographed as the
 * bare "did not answer this request" alert - must read the same hook.
 *
 * WHY A SCAN AND NOT A RENDER. The sidebar cannot be mounted by this
 * repository's `node:test` suite (see `chat-sidebar-view.test.mjs`'s header),
 * so a decision written as a JSX condition is a decision no test can reach -
 * the answer these suites use is to slice the file at named markers, the way
 * `chat-sidebar-archive.test.mjs` does for the archive lane. `between` fails
 * loudly when a marker is missing or the slice is implausibly small, because a
 * marker that stops matching silently turns a claim into an empty-string pass.
 *
 * WHAT IT CANNOT SAY: that the screen looks right. The pixels of the two-voice
 * state are the rig's job (`renderer-driver.mjs`'s `connection-drop` scene on
 * the built app, with the daemon killed mid-run), and its frames are the claim.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const STRIP = "src/renderer/src/features/chat/components/chat-status-strip.tsx";
const PRESENCE = "src/renderer/src/features/chat/chat-status-presence.ts";
const CHAT_PAGE = "src/renderer/src/features/chat/components/chat-page.tsx";
const SOURCE = readFileSync(SIDEBAR, "utf8");
const STRIP_SOURCE = readFileSync(STRIP, "utf8");
const PRESENCE_SOURCE = readFileSync(PRESENCE, "utf8");
const PAGE_SOURCE = readFileSync(CHAT_PAGE, "utf8");

/*
 * The literals these cases assert on, at module scope: `useTopLevelRegex` is a
 * warning rather than an error here, and a new file in this tree is exactly the
 * diff those are meant to keep quiet.
 */
const ERROR_COPY_ROW = /capabilities\.error\.message/;
const NOTICE_ROW = /<p>\{notice\}<\/p>/;
const RETRY_REFRESH = /Retry refresh/;
const SHARED_GATE = "!stripSpeaksConnection";
const STRIP_IMPORT =
	/import \{ useStripSpeaksConnection \} from "\.\.\/chat-status-presence";/;
const SIDEBAR_HOOK_CALL =
	/const stripSpeaksConnection = useStripSpeaksConnection\(\s*serverHealth\?\.online === false,\s*\);/;
const PRESENCE_TWO_TERMS =
	/export function useStripSpeaksConnection\(serverOffline: boolean\): boolean \{\s*return useChatStatusStripPresent\(\) && serverOffline;/;
const PRESENCE_DEFAULT = /let stripPresent = false;/;
const PANE_YIELDS = /error && !stripSpeaksConnection/;
const STRIP_PUBLISHES_IMPORT =
	/import \{ setChatStatusStripPresent \} from "\.\.\/chat-status-presence";/;
const STRIP_SPEAKING = /const speaking = display !== null;/;
const STRIP_PUBLISH_CALL = /setChatStatusStripPresent\(speaking\);/;
const STRIP_UNMOUNT_CLEARS =
	/return \(\) => setChatStatusStripPresent\(false\);/;

/** The slice between two markers; a missing marker or a tiny slice is a failure. */
const between = (start, end) => {
	const from = SOURCE.indexOf(start);
	assert.notEqual(from, -1, `the start marker is gone: ${start}`);
	const to = SOURCE.indexOf(end, from + start.length);
	assert.notEqual(to, -1, `the end marker is gone after it: ${end}`);
	const slice = SOURCE.slice(from, to);
	assert.ok(
		slice.length > 150,
		`the slice between the markers is ${slice.length} characters - a marker pair that resolves ahead of itself reads as an empty pass`,
	);
	return slice;
};

test("the capability paragraph stands down on the strip's own reading", () => {
	const block = between(
		"{capabilities.error && !stripSpeaksConnection && (",
		"\n\t\t\t{/*",
	);
	assert.match(block, ERROR_COPY_ROW);
	assert.match(block, RETRY_REFRESH);
	assert.equal(
		block.includes('role="alert"'),
		false,
		"the strip owns the one live region for connection state; a second live region about one fact is the duplicate the finding names",
	);
});

test("the withdrawn-gate paragraph takes the same stand-down", () => {
	const block = between(
		"{notice && !stripSpeaksConnection && (",
		"\n\t\t\t{/*",
	);
	assert.match(block, NOTICE_ROW);
	assert.match(block, RETRY_REFRESH);
	assert.equal(
		block.includes('role="alert"'),
		false,
		"a withdrawn gate is read off the same stale answer a just-killed server leaves behind - without the gate the block speaks over the strip",
	);
});

test("the foot line and the two paragraphs read one predicate, not three", () => {
	// The drift the comment in the component names: the sites agreeing about
	// when the strip owns the screen all read ONE predicate. The list caption
	// joined them in design review round 3 (D30) - its connection half restated
	// the strip's sentence one row away - so there are FOUR readers now, and a
	// fifth spelling, or a site that leaves the shared reading, fails here rather
	// than on a screen.
	const sites = SOURCE.split(SHARED_GATE).length - 1;
	assert.equal(
		sites,
		4,
		`found ${sites} site(s) reading the shared predicate - expected the two list-pane paragraphs, the foot line and (D30) the list caption`,
	);
	const foot = between(
		"{(error || profiles.error || teams.error) &&",
		"\n\t\t\t{/*",
	);
	assert.ok(
		foot.includes(SHARED_GATE),
		"the foot line reads the same predicate as the two paragraphs",
	);
	const caption = between("feed.available &&", "Not connected");
	assert.ok(
		caption.includes(SHARED_GATE),
		"the caption reads the same predicate (D30): with the strip up it stands down, and off /chat it speaks again",
	);
});

test("the shared predicate carries the strip's presence beside the copy condition (R11)", () => {
	assert.match(
		SOURCE,
		SIDEBAR_HOOK_CALL,
		"the sidebar must read the shared predicate: 'the strip is on screen AND unreachability is the reason' - a one-term version is the silent-route defect R11 found",
	);
	assert.match(
		SOURCE,
		STRIP_IMPORT,
		"the reading comes from the module the strip publishes to, and the same hook the pane's own stand-down uses",
	);
});

test("the presence hook is two terms, with presence as its default (R11)", () => {
	assert.match(
		PRESENCE_SOURCE,
		PRESENCE_TWO_TERMS,
		"presence AND offline: presence alone would stand a surface down over a healthy server, and offline alone is the defect R11 found",
	);
	assert.match(
		PRESENCE_SOURCE,
		PRESENCE_DEFAULT,
		"the store's default is 'no strip on screen', which keeps every consumer speaking until one renders",
	);
});

test("the pane's own catalogue error yields to the strip (R11)", () => {
	/*
	 * The finding's whole point was that ONE surface yielded and the rest did not.
	 * The pane states a lost server as its catalogue error (the transport's own
	 * sentence, which is the one the walker's before-run photographed as the bare
	 * alert at the top of the pane), so it has to read the same predicate the
	 * sidebar does - and it is the surface where the presence term is free, because
	 * the strip it yields to is mounted in the very same tree.
	 */
	assert.match(
		PAGE_SOURCE,
		SIDEBAR_HOOK_CALL,
		"the pane reads the shared predicate",
	);
	assert.ok(
		PAGE_SOURCE.includes("routeError ||"),
		"the pane still renders its own route error: the nav facts are not the strip's to state",
	);
	assert.match(
		PAGE_SOURCE,
		PANE_YIELDS,
		"the CATALOGUE half stands down while the strip speaks; the ROUTE half must not",
	);
});

test("the strip publishes its own presence while it is drawn (R11)", () => {
	assert.match(
		STRIP_SOURCE,
		STRIP_PUBLISHES_IMPORT,
		"the strip is the publisher of the fact the sidebar consumes",
	);
	assert.match(
		STRIP_SOURCE,
		STRIP_SPEAKING,
		"presence is 'has something to say', and the dismissed pill still counts",
	);
	assert.match(STRIP_SOURCE, STRIP_PUBLISH_CALL, "the publish call itself");
	assert.match(
		STRIP_SOURCE,
		STRIP_UNMOUNT_CLEARS,
		"an unmounted strip owns nothing: the cleanup must clear the flag",
	);
});
