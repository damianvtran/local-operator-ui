import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * A DRAFT PANE'S SLASH IDENTITY (issue #780), pinned at the two seams the live
 * bug crossed and at the wire that refused it.
 *
 * WHAT WENT WRONG, and why the fixtures could not see it: typing `/team` or
 * `/agent` on a new chat fired `commands.entities` with the pane's synthetic
 * `draft:<uuid>` key. The op schema (`desktop-contract.ts` `sessionIdPattern`)
 * refuses that key, so the query errored and the popup drew "The list could not
 * be loaded. Try again." until a first send created a session — while every
 * fixture-staged rig passed, because a story bridge answers whatever op it is
 * handed and no schema runs there. The same class was fixed once for `/mcp`
 * alone (`mcp-catalog.ts` `mcpTransportSession`, PR #726), whose comment
 * records the live 422.
 *
 * THE ARMS THAT CAN BE RED, and why they are the honest ones:
 *
 *  1. The WIRE arm (always true, the negative control): the raw draft key is
 *     exactly what `commands.entities`' schema refuses, and a canonical id is
 *     what it accepts. A test that cannot fail is not evidence; this arm proves
 *     the refusal half is real on the tree being tested.
 *  2. The REGISTRY arm: the two rows a draft pane must answer through the
 *     sessionless roster reads are DECLARED as such (`draftIdentity` on the
 *     destination table, the same per-row opt-in pattern `sessionless` uses).
 *     On the broken tree this fails — the field does not exist — and it is the
 *     cheap, focused form of the report's feature half.
 *  3. The GATE arm: the composer no longer keys its entity session on
 *     `sessionStatus` (which a DRAFT pane supplies from the preview) but routes
 *     the conversation key through the wire's own pattern. On the broken tree
 *     this fails, naming the exact line the report cites.
 *  4. The YIELD arm (design round 1, D3): below the roster the empty-state
 *     splash is a surface this branch's popup would newly cover, and clearing
 *     it by a height cap is arithmetically impossible (the popup's fixed bottom
 *     leaves 77.9px, less than its label and footer), so the shipped
 *     arrangement is a YIELD — the splash is not drawn while the argument list
 *     is open. A source fact, pinned here because the frame that shows it needs
 *     a rig.
 *
 * These run against the SHIPPED modules (`picker-registry.tsx`,
 * `desktop-contract.ts`) and the shipped SOURCE (message-input.tsx), the same
 * pattern `draft-selection.test.mjs` uses for call-site facts no fixture can
 * see. The draft identity's store half (`restageDraft`) is pinned beside them;
 * the live path is exercised by the desktop suite and the review rounds.
 */

const COMPOSER =
	"src/renderer/src/shared/components/composer/message-input.tsx";

/* Hoisted for the linter (`useTopLevelRegex`), like the assertions they feed. */
const SLASH_SESSION_STATUS_GATE = /slashSessionId\s*=\s*sessionStatus\s*\?/;
const SLASH_SESSION_PATTERN_GATE =
	/const slashSessionId = entitySessionId\(conversationId\)/;
const DRAFT_STAGE_DISPATCHER_GATE =
	/row\.kind === "argument" &&\s*!paneHasSession &&\s*Boolean\(onSlashCommand\)/;
const SPLASH_YIELDS_TO_PICKER =
	/showEmptyChatPrompt && !\(slash\.open && slash\.phase === "argument"\)/;
const SPLASH_CLASS_READS_YIELD =
	/showSplash\s*\?\s*"flex w-full flex-col items-center gap-6 py-4"/;

/*
 * The minimum the bundle's import chain touches at module scope: the stores
 * read `localStorage` at creation (they persist), and react-dom reads
 * `navigator.userAgent`. No case here RENDERS, so the document is only the one
 * the imported modules expect to exist.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const originals = new Map();
const realSetTimeout = globalThis.setTimeout;

for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	navigator: {
		platform: "MacIntel",
		userAgent: window.navigator.userAgent,
	},
	HTMLElement: window.HTMLElement,
	HTMLTextAreaElement: window.HTMLTextAreaElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	MouseEvent: window.MouseEvent,
	ClipboardEvent: window.ClipboardEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
	requestAnimationFrame: (callback) => realSetTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

const worktree = process.cwd();
const bundle = await build({
	stdin: {
		contents: [
			'export { desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { DESTINATIONS, destinationNeedsSession, draftStageForSource } from "./src/renderer/src/features/chat/pickers/picker-registry";',
			'export { entitySessionId } from "./src/renderer/src/features/chat/components/slash-contract";',
			'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";',
			'export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";',
		].join("\n"),
		resolveDir: worktree,
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
	alias: {
		"@shared": `${worktree}/src/renderer/src/shared`,
		"@features": `${worktree}/src/renderer/src/features`,
		"@assets": `${worktree}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
});
/*
 * The bundle goes to a FILE rather than a data: URL, because it keeps react
 * external and a data: URL has no node_modules beside it to resolve them from
 * (measured: ERR_INVALID_URL on `react`). Written beside this file so module
 * resolution walks up the same tree the real suite does, and removed as soon as
 * it is imported.
 */
const bundlePath = new URL(
	`./_draft-slash-identity-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let desktopRequestSchema;
let DESTINATIONS;
let destinationNeedsSession;
let draftStageForSource;
let entitySessionId;
let useCanonicalSessionsStore;
let useConversationInputStore;
try {
	({
		desktopRequestSchema,
		DESTINATIONS,
		destinationNeedsSession,
		draftStageForSource,
		entitySessionId,
		useCanonicalSessionsStore,
		useConversationInputStore,
	} = await import(bundlePath.href));
} finally {
	await unlink(bundlePath);
}

const parses = (payload) => desktopRequestSchema.safeParse(payload).success;

test("a draft key is exactly what commands.entities' schema refuses (the wire class)", () => {
	// The negative control: the raw pair the broken tree sent. Both the draft
	// key and a non-hex key fail; a canonical 12-hex id passes.
	assert.equal(
		parses({
			op: "commands.entities",
			sessionId: "draft:1234",
			command: "team",
		}),
		false,
	);
	assert.equal(
		parses({
			op: "commands.entities",
			sessionId: "abcdef123456",
			command: "team",
		}),
		true,
	);
});

test("the team and agent rows are declared draft-answerable in the registry", () => {
	/*
	 * The feature half's cheap form: on a pane with no conversation these two
	 * destinations are answered through the sessionless roster reads and a pick
	 * STAGES the draft's identity. The declaration is the per-row opt-in, and no
	 * other picker row may carry it (a widening would let `/skills` or `/mcp`
	 * claim a draft route they do not have).
	 */
	assert.equal(DESTINATIONS["session.team"].draftIdentity, "team");
	assert.equal(DESTINATIONS["session.agent"].draftIdentity, "agent");
	for (const [destination, entry] of Object.entries(DESTINATIONS)) {
		if (entry.kind !== "picker") continue;
		if (destination === "session.team" || destination === "session.agent")
			continue;
		assert.equal(
			entry.draftIdentity,
			undefined,
			`${destination} must not declare a draft identity`,
		);
	}
	/*
	 * AND THE PREDICATE ITSELF IS UNCHANGED (deliberately, issue #780): these
	 * two destinations still address a conversation in the ordinary sense — the
	 * refusal copy, the palette's "does this need a chat" route question and the
	 * footer's pane clause all read it — while the draft route is the ROW's
	 * own `draftIdentity`, read by the dispatcher before that refusal and by the
	 * composer's pick. Flipping this predicate is what would silently change the
	 * palette's navigation.
	 */
	assert.equal(destinationNeedsSession("session.team"), true);
	assert.equal(destinationNeedsSession("session.agent"), true);
	/*
	 * The composer's own walk from an inline source to the stage it performs,
	 * derived from the same table — and nothing for the lists that are only
	 * honoured on a session.
	 */
	assert.equal(draftStageForSource("team"), "team");
	assert.equal(draftStageForSource("agent"), "agent");
	assert.equal(draftStageForSource("model"), undefined);
	assert.equal(draftStageForSource("mcp"), undefined);
	assert.equal(draftStageForSource(undefined), undefined);
});

test("the composer's entity session is gated on the wire's own pattern, not sessionStatus", () => {
	const source = readFileSync(COMPOSER, "utf8");
	/*
	 * The exact expression the report cites (:2826). A draft pane supplies
	 * `sessionStatus` from the preview, so keying on it hands the entity query
	 * the pane's synthetic `draft:<uuid>` — the key the schema refuses.
	 */
	assert.doesNotMatch(
		source,
		SLASH_SESSION_STATUS_GATE,
		"slashSessionId must not key on sessionStatus (a draft pane supplies it from the preview)",
	);
	assert.match(
		source,
		SLASH_SESSION_PATTERN_GATE,
		"slashSessionId routes the conversation key through the wire's own session pattern",
	);
});

test("the draft-stage pick requires a wired dispatcher, so the config box stays inert", () => {
	const source = readFileSync(COMPOSER, "utf8");
	/*
	 * The config box (`agents/config-run/config-composer.tsx`, which mounts this
	 * composer with no `onSlashCommand` — its own comment: the command write
	 * paths stay closed) also has no session, so `!paneHasSession` alone let a
	 * team-row pick there restage a CHAT draft from a page that writes nothing
	 * (review round 1, M1). Those rows are `runs: false`, so `shouldRun` can
	 * never pass for them and this branch — which must sit before it — carries
	 * the dispatcher term itself; pinned here so a refactor cannot drop it
	 * silently.
	 */
	assert.match(
		source,
		DRAFT_STAGE_DISPATCHER_GATE,
		"the draft-stage pick must require an onSlashCommand-backed host",
	);
});

test("the splash the roster would cover yields while the argument picker is open", () => {
	const source = readFileSync(COMPOSER, "utf8");
	/*
	 * Design round 1, D3: the roster reaches up into the empty-state splash, and
	 * clearing the band by a height cap is arithmetically impossible (the popup's
	 * fixed bottom leaves 77.9px there — less than its label and footer), so the
	 * shipped arrangement is a YIELD: the splash's drawn-state reads the slash
	 * state's ARGUMENT phase. Pinned as a source fact like the arm above,
	 * because the frame that shows it needs a rig; the conditional's two terms
	 * are the whole arrangement, and the command phase is deliberately not in
	 * them (a pre-existing overlay this fix does not touch).
	 */
	assert.match(
		source,
		SPLASH_YIELDS_TO_PICKER,
		"the splash's drawn-state must yield while the slash argument list is open",
	);
	assert.match(
		source,
		SPLASH_CLASS_READS_YIELD,
		"the splash group's class must read the yielding flag, not the raw prompt flag",
	);
});

test("the gate drops a draft key and keeps a canonical id (what may key the entity lists)", () => {
	assert.equal(entitySessionId("abcdef123456"), "abcdef123456");
	assert.equal(entitySessionId("draft:1234"), undefined);
	assert.equal(entitySessionId("draft:team:engineering"), undefined);
	assert.equal(entitySessionId("mini-view:unseated"), undefined);
	assert.equal(entitySessionId("send:abcdef123456"), undefined);
	// Case-sensitive, like the wire: the schema's own test.
	assert.equal(entitySessionId("ABCDEF123456"), undefined);
	assert.equal(entitySessionId(undefined), undefined);
	assert.equal(entitySessionId(""), undefined);
});

test("a restage moves the box's text onto the picked draft and keeps the target", () => {
	const input = () => useConversationInputStore.getState();
	const canonical = () => useCanonicalSessionsStore.getState();
	const from = canonical().stageDraft(undefined, true);
	input().setComposerText(from, "please fix the flaky test");
	const key = canonical().restageDraft(
		{ kind: "team", name: "engineering" },
		"please fix the flaky test",
	);
	assert.equal(key, "draft:team:engineering");
	assert.equal(canonical().activeDraftKey, key);
	assert.deepEqual(canonical().drafts[key]?.target, {
		kind: "team",
		name: "engineering",
	});
	assert.equal(input().getCurrentInput(key), "please fix the flaky test");
	// A MOVE, not a copy: the abandoned key is not left holding a token whose
	// command has been consumed.
	assert.equal(input().getCurrentInput(from), "");
});

test("a bare restage carries the box as it stands", () => {
	const from = useCanonicalSessionsStore.getState().stageDraft(undefined, true);
	useConversationInputStore.getState().setComposerText(from, "hello");
	const key = useCanonicalSessionsStore
		.getState()
		.restageDraft({ kind: "agent", name: "scout" });
	assert.equal(key, "draft:agent:scout");
	assert.equal(
		useConversationInputStore.getState().getCurrentInput(key),
		"hello",
	);
	assert.equal(useConversationInputStore.getState().getCurrentInput(from), "");
});
