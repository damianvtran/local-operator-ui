import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The conversation-name contract: the row a user clicked and the header they
 * land on name the same conversation, and an empty live title never destroys a
 * name the catalogue already knew.
 *
 * A defect, not a style preference: `conversation_title` is the backend's
 * JOURNALLED title, and most of a real store has none (of the operator's 1407
 * sessions, 1180 are named in the sidebar from their opening message by
 * `resume.session_name()`). So clicking such a row opened a chat saying
 * "Untitled chat", and the header's own write into the catalogue blanked the
 * row the click came from until the next 5s list poll.
 *
 * The store is bundled for real rather than modelled, because half of this
 * contract IS the store's merge: `upsertSession` spreads the incoming row, so
 * a title key that is present and empty overwrites and only an ABSENT key
 * leaves the existing name standing. A test that re-implemented the merge would
 * pass against exactly the payload that caused the defect.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
const calls = [];
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	return {};
};
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {isBlankTitle, resolveChatTitle, catalogueTitleUpdate, UNTITLED_CHAT} from "./src/renderer/src/features/chat/chat-title";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "canonical-transport-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__canonicalRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const {
	useCanonicalSessionsStore: store,
	isBlankTitle,
	resolveChatTitle,
	catalogueTitleUpdate,
	UNTITLED_CHAT,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The catalogue name a row keeps for a session whose transcript has an opener. */
const OPENER_NAME = "Improve ask function clickable options";

function reset(rows = []) {
	calls.length = 0;
	store.setState({ sessions: rows, activeSessionId: null, error: null });
}

/**
 * `chat-page.tsx`'s own write, over the real store, for one live tick.
 *
 * The third argument the call site used to pass - the row's own `title` - is
 * gone, so this helper takes only what the write now reads. That is the point of
 * agent review round 1's F1: the value was the row's own name, so writing it back
 * could never change the merged row, and a helper that kept passing it would keep
 * the suite green against a branch that did nothing.
 */
function streamTick(sessionId, liveTitle) {
	store.getState().upsertSession({
		session_id: sessionId,
		...catalogueTitleUpdate({ liveTitle }),
		attention: undefined,
	});
}

test("a blank live title falls back to the catalogue name the row was clicked under", () => {
	// The reported defect, at the header.
	assert.equal(
		resolveChatTitle({
			draftKey: null,
			liveTitle: "",
			catalogueTitle: OPENER_NAME,
		}),
		OPENER_NAME,
	);
	// The cold-state shape is absent rather than empty for some paths, and both
	// have to land on the row's name.
	assert.equal(
		resolveChatTitle({ liveTitle: undefined, catalogueTitle: OPENER_NAME }),
		OPENER_NAME,
	);
	// Whitespace is "no name", not "a name made of spaces": the backend
	// whitespace-normalises journalled titles, so this arrives as unknown.
	assert.equal(
		resolveChatTitle({ liveTitle: "   ", catalogueTitle: OPENER_NAME }),
		OPENER_NAME,
	);
});

test("a live title wins, so a rename still shows where it landed", () => {
	assert.equal(
		resolveChatTitle({
			liveTitle: "Retention sweep notes",
			catalogueTitle: OPENER_NAME,
		}),
		"Retention sweep notes",
	);
	// The journalled title with no live value is the regression case: the
	// catalogue carries it, so the header must still wear it.
	assert.equal(
		resolveChatTitle({
			liveTitle: "",
			catalogueTitle: "Retention sweep notes",
		}),
		"Retention sweep notes",
	);
});

test("a conversation neither source can name is untitled", () => {
	assert.equal(
		resolveChatTitle({ liveTitle: "", catalogueTitle: "" }),
		UNTITLED_CHAT,
	);
	assert.equal(resolveChatTitle({}), UNTITLED_CHAT);
	assert.equal(
		resolveChatTitle({ liveTitle: null, catalogueTitle: undefined }),
		UNTITLED_CHAT,
	);
});

test("the draft branch is the draft's own name and never the row's", () => {
	assert.equal(
		resolveChatTitle({
			draftKey: "draft-1",
			draftTarget: "coder",
			liveTitle: "",
			catalogueTitle: OPENER_NAME,
		}),
		"New chat with coder",
	);
	assert.equal(
		resolveChatTitle({
			draftKey: "draft-1",
			draftTarget: "",
			liveTitle: "",
			catalogueTitle: OPENER_NAME,
		}),
		"New chat",
	);
});

test("a streaming tick with an empty live title leaves the row's name standing", () => {
	reset([{ session_id: "aaaa11112222", title: OPENER_NAME }]);
	streamTick("aaaa11112222", "");
	assert.equal(store.getState().sessions[0].title, OPENER_NAME);
	// The defect's other half: it re-blanked on EVERY frontend update, so one
	// tick is not the assertion - a turn's worth of them is.
	for (let tick = 0; tick < 40; tick += 1)
		streamTick("aaaa11112222", "");
	assert.equal(store.getState().sessions[0].title, OPENER_NAME);
});

test("a whitespace-only live title cannot blank the row either", () => {
	reset([{ session_id: "aaaa11112222", title: OPENER_NAME }]);
	streamTick("aaaa11112222", "   ");
	assert.equal(store.getState().sessions[0].title, OPENER_NAME);
});

test("a non-blank live title does reach the row", () => {
	reset([{ session_id: "aaaa11112222", title: OPENER_NAME }]);
	streamTick("aaaa11112222", "Retention sweep notes");
	assert.equal(store.getState().sessions[0].title, "Retention sweep notes");
});

test("a row with no name at all gains none from an empty live title", () => {
	reset([{ session_id: "cccc33334444" }]);
	streamTick("cccc33334444", "");
	const row = store.getState().sessions[0];
	// Absent, not `""`: the sidebar's own fallback renders both as "Untitled
	// chat", and an empty STRING would additionally make a nameless row look
	// named to anything that tests the key's presence.
	assert.equal("title" in row, false);
	assert.equal(resolveChatTitle({ liveTitle: "", catalogueTitle: row.title }), UNTITLED_CHAT);
});

test("isBlankTitle is the one definition both rules read", () => {
	assert.equal(isBlankTitle(undefined), true);
	assert.equal(isBlankTitle(null), true);
	assert.equal(isBlankTitle(""), true);
	assert.equal(isBlankTitle("  \t\n"), true);
	assert.equal(isBlankTitle("Named"), false);
});
