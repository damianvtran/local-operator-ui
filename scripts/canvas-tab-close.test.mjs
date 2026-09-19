import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Closing a document tab CLOSES it, and the words a refused write could not save
 * are not lost by the close.
 *
 * WHY THIS FILE EXISTS, in the shape of the incident it prevents. A reader closed
 * a tab in the canvas, watched it flicker, and found the file still open. The
 * close itself was correct - the tab is gone from `files` the moment the ✕
 * handler runs - and then the viewer UNMOUNTS, and every editable surface's
 * cleanup is `closeBuffer(document.id)`. The buffer owner flushed, handed the
 * words to its store port, and that port was an UPSERT (`[...files, document]`),
 * so the document came straight back into the list the strip and the pane are
 * drawn from. Every close re-opened what it had just closed, and no unit test
 * could see it: the untested half was the ORDER (close, then unmount, then
 * commit), and the harm needs a store to come back into.
 *
 * So this file drives that order, in that order, against the shipped modules -
 * esbuild bundles `document-buffers.ts` (the buffer owner), `canvas-store.ts`
 * (the persisted store the strip and the pane render) and `file-freshness.ts`
 * (the gate) from source. The bridge, `probe`/`write`, is the only fake, and it
 * is a fake of the BRIDGE (a `stat` answer and a `writeFile`), never of a
 * decision. The ✕ handler's body is transcribed (`closeTab` below) because it
 * lives inside a React component no headless run can mount; the REAL press on the
 * real strip is `node scripts/renderer-driver.mjs --scene canvas-freshness`, which
 * closes a tab by clicking its own control in the built app.
 *
 * WHAT A CLOSE OWES, and where it is asserted:
 *
 * - the document leaves `files` and `openTabs`, and the unmount commit does not
 *   put it back - (a), (a2), (b), (c);
 * - a close whose write was REFUSED (the file moved on disk under the reader)
 *   keeps the reader's words, and the canvas asks for them again when the same
 *   path is opened in this session - (c), (c2);
 * - an unmount that is NOT a close (a tab switch) still keeps the store's copy of
 *   the open document current - (b2), the case R4-7 named;
 * - the tab the close LEAVES THE READER ON is the neighbour - the following tab, or
 *   the preceding one when the closed tab was last, and unchanged when a background
 *   tab is closed - (a3), on the shipped `tabFollowingClose` rule that all three
 *   sites call (design review round 1, D1);
 * - the projection is a stable identity between changes, so the memoised canvas
 *   subtree is not re-rendered by every keystroke - (c4), agent review round 1, M2;
 * - the projection builds nothing while a component renders: a grid's workbook is
 *   materialised at the write and handed back from there - (c3);
 * - and the boundary of the promise, stated rather than implied: a restart is not
 *   covered, and a close is not what loses the words when it happens - (d).
 */

/*
 * The persisted store is the real one (`zustand/middleware`'s `persist`), and it
 * needs a `localStorage` to exist before the module is imported. An in-memory one
 * is also how (d) asks what a restart would find: the snapshot the app writes is
 * a fact, and a claim about surviving an app restart has to read it.
 */
const persistedStore = new Map();
globalThis.localStorage = {
	getItem: (key) => persistedStore.get(key) ?? null,
	setItem: (key, value) => persistedStore.set(key, String(value)),
	removeItem: (key) => persistedStore.delete(key),
};

const bundle = await build({
	stdin: {
		contents: `
			export { useCanvasStore } from "./src/renderer/src/shared/store/canvas-store";
			export {
				adoptBuffer,
				proposeBuffer,
				saveBuffer,
				closeBuffer,
				bufferText,
				bufferIsDirty,
				commitCanvasDocument,
				documentsForCanvas,
				resetBuffers,
				setBufferPorts,
			} from "./src/renderer/src/features/chat/components/canvas/document-buffers";
			export { canvasDocumentForPath } from "./src/renderer/src/features/chat/utils/canvas-document";
			export { tabFollowingClose } from "./src/renderer/src/features/chat/components/canvas/tab-selection";
			export {
				createFreshnessRunner,
				clearDocumentDirty,
				isDocumentDirty,
				isAutosaveHeld,
				releaseDocumentHold,
				setDocumentFact,
				documentFact,
			} from "./src/renderer/src/features/chat/components/canvas/file-freshness";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@features": "./src/renderer/src/features",
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const {
	useCanvasStore,
	adoptBuffer,
	proposeBuffer,
	saveBuffer,
	closeBuffer,
	bufferText,
	bufferIsDirty,
	commitCanvasDocument,
	documentsForCanvas,
	resetBuffers,
	setBufferPorts,
	canvasDocumentForPath,
	tabFollowingClose,
	createFreshnessRunner,
	clearDocumentDirty,
	isDocumentDirty,
	isAutosaveHeld,
	releaseDocumentHold,
	setDocumentFact,
	documentFact,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

// ---------------------------------------------------------------- fixtures

const CONVERSATION = "conv-close";

/** A fake bridge: one file table, a clock that moves on every write. */
function bridge({ mtimeMs = 100 } = {}) {
	const files = new Map();
	const writes = [];
	let clock = mtimeMs;
	return {
		files,
		writes,
		ports: {
			probe: async (path) => {
				const file = files.get(path);
				return file
					? { exists: true, isFile: true, mtimeMs: file.mtimeMs, error: null }
					: { exists: false, isFile: false, mtimeMs: null, error: null };
			},
			write: async (path, text) => {
				clock += 5;
				files.set(path, { text, mtimeMs: clock });
				writes.push({ path, text });
			},
		},
	};
}

/**
 * The case's own bridge, and one empty conversation on a fresh registry. Every
 * test starts here: one file table, one canvas, nothing left from the last test.
 */
let io = null;
function openCase(path, text, { mtimeMs = 100 } = {}) {
	io = bridge({ mtimeMs });
	io.files.set(path, { text, mtimeMs });
	resetBuffers();
	setBufferPorts(io.ports);
	useCanvasStore.getState().resetConversationCanvas(CONVERSATION);
	return io;
}

/** A file changing on disk, written by anything that is not this app. */
const fileMoves = (path, text, mtimeMs) =>
	io.files.set(path, { text, mtimeMs });

/** A document as the click path builds one, with its baseline stated. */
const openedDocument = (path, content, readMtimeMs) =>
	canvasDocumentForPath(path, { content, readMtimeMs });

/** The document opened on screen: the store's list, as the canvas reads it. */
const open = () => useCanvasStore.getState().conversations[CONVERSATION];

/** What the canvas would render. */
const rendered = () => documentsForCanvas(open().files);

/**
 * The store port an editor registers, transcribed from the three surfaces: the
 * buffer's words become the store's copy of THIS document.
 */
const portFor = (document) => (text, mtimeMs) =>
	commitCanvasDocument(CONVERSATION, {
		...document,
		content: text,
		readMtimeMs: mtimeMs ?? document.readMtimeMs,
		lastAgentModified: mtimeMs ?? document.lastAgentModified,
	});

/** The editor's own first effect: register the document, hand over the port. */
function mountEditor(document) {
	adoptBuffer({
		documentId: document.id,
		path: document.path,
		text: document.content,
		mtimeMs: document.readMtimeMs,
		commit: portFor(document),
	});
}

/**
 * `handleCloseDocument` in `chat-content.tsx`, in its own order: both lists lose
 * the document, and the selection moves to the tab that takes its place.
 *
 * The selection rule is NOT transcribed: it is `tabFollowingClose`, the module the
 * shipped handler and the pane's own handler both call (design review round 1, D1),
 * so what this file asserts about the reader's landing place is the shipped rule.
 */
function closeTab(documentId) {
	const state = useCanvasStore.getState();
	const conversation = state.conversations[CONVERSATION];
	const newTabs = conversation.openTabs.filter((tab) => tab.id !== documentId);
	const newFiles = conversation.files.filter((file) => file.id !== documentId);
	state.setOpenTabs(CONVERSATION, newTabs);
	state.setFiles(CONVERSATION, newFiles);
	if (conversation.selectedTabId === documentId) {
		state.setSelectedTab(
			CONVERSATION,
			tabFollowingClose(conversation.files, documentId)?.id ?? null,
		);
	}
}

/** The close's second half, and the waits the async arms need to settle. */
const settleAfter = async (documentId) => {
	closeBuffer(documentId);
	await new Promise((resolve) => setTimeout(resolve, 20));
};

// ------------------------------------------------------------ (a) the close

test("(a) a closed clean tab is gone, and the unmount commit does not bring it back", async () => {
	const path = "/tmp/close-clean.md";
	openCase(path, "one\n");
	const document = openedDocument(path, "one\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);
	mountEditor(document);
	assert.equal(open().files.length, 1, "the document is open");

	closeTab(document.id);
	assert.deepEqual(
		[open().files.length, open().openTabs.length, open().selectedTabId],
		[0, 0, null],
		"the ✕ handler closes the document itself",
	);

	await settleAfter(document.id);

	assert.deepEqual(
		[open().files.length, open().openTabs.length],
		[0, 0],
		"the unmount commit must not re-list a document the reader closed",
	);
	assert.deepEqual(rendered(), [], "and the canvas has nothing to render");
});

test("(a2) a second tab closed by the same strip leaves the first one closed", async () => {
	const first = "/tmp/close-first.md";
	const second = "/tmp/close-second.md";
	openCase(first, "first\n");
	io.files.set(second, { text: "second\n", mtimeMs: 100 });
	const a = openedDocument(first, "first\n", 100);
	const b = openedDocument(second, "second\n", 100);
	const store = useCanvasStore.getState();
	store.addFileAndSelect(CONVERSATION, a);
	store.addFileAndSelect(CONVERSATION, b);
	mountEditor(a);
	mountEditor(b);
	assert.equal(open().files.length, 2);

	closeTab(a.id);
	await settleAfter(a.id);
	assert.equal(open().files.length, 1, "the first close stuck");
	closeTab(b.id);
	await settleAfter(b.id);

	assert.deepEqual(
		[open().files.length, open().openTabs.length],
		[0, 0],
		"and the second close that followed it stuck too",
	);
});

// ---------------------------------------- (a3) where a close leaves the reader

test("(a3) a close lands the reader on the neighbour, never on the oldest tab", async () => {
	const paths = ["/tmp/land-a.md", "/tmp/land-b.md", "/tmp/land-c.md"];
	openCase(paths[0], "a\n");
	for (const path of paths.slice(1))
		io.files.set(path, { text: "x\n", mtimeMs: 100 });
	const docs = paths.map((path) => openedDocument(path, "x\n", 100));
	const [a, b, c] = docs;
	for (const document of docs)
		useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);

	/*
	 * The rule itself, asserted on the shipped module rather than on a copy of it.
	 * "Following, else preceding, else nothing" is the APG's rule for a deleted tab
	 * and the one Chrome, VS Code and Safari use; the sites this PR fixes used to
	 * take `[0]`, which in the reader's usual five-document strip is the tab they
	 * opened FIRST.
	 */
	assert.equal(
		tabFollowingClose([a, b, c], b.id)?.id,
		c.id,
		"the tab following the closed one",
	);
	assert.equal(
		tabFollowingClose([a, b, c], c.id)?.id,
		b.id,
		"or the one before it, when the closed tab was last",
	);
	assert.equal(
		tabFollowingClose([a], a.id),
		null,
		"and nothing at all when that was the only tab",
	);
	assert.equal(
		tabFollowingClose([a, b, c], "/tmp/never-open.md"),
		null,
		"a document that was never open moves the reader nowhere",
	);

	/*
	 * And through the handler's own order, on the store: the middle document is
	 * selected, its ✕ pressed, and the reader must be on the THIRD tab - not on the
	 * first, which is what the pre-fix sites picked and what the strip's own
	 * `scrollIntoView` would then slide the whole row to show.
	 */
	useCanvasStore.getState().setSelectedTab(CONVERSATION, b.id);
	closeTab(b.id);
	assert.equal(
		open().selectedTabId,
		c.id,
		"closing the selected middle tab selects the neighbour that took its place",
	);

	/* Closing the last remaining tab falls back to the one before it, not to `[0]`. */
	closeTab(c.id);
	assert.equal(
		open().selectedTabId,
		a.id,
		"closing the last tab selects the preceding one",
	);

	/*
	 * A ✕ on a tab the reader is NOT reading moves the selection nowhere: the pane
	 * must not swap the document under them because a background tab went away.
	 */
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, b);
	useCanvasStore.getState().setSelectedTab(CONVERSATION, a.id);
	closeTab(b.id);
	assert.equal(
		open().selectedTabId,
		a.id,
		"closing a background tab leaves the reader's own document selected",
	);
});

// ------------------------------------------------- (b) the dirty close arms

test("(b) closing a dirty tab whose file has not moved writes the bytes and keeps the tab closed", async () => {
	const path = "/tmp/close-dirty.md";
	const bridge = openCase(path, "one\n");
	const document = openedDocument(path, "one\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);
	mountEditor(document);
	proposeBuffer(document.id, "the reader's words");

	closeTab(document.id);
	await settleAfter(document.id);

	assert.deepEqual(
		bridge.writes.map((write) => write.text),
		["the reader's words"],
		"the flush reaches the file",
	);
	assert.deepEqual(
		[open().files.length, open().openTabs.length],
		[0, 0],
		"and the tab is still closed after the write landed",
	);
	assert.equal(bufferIsDirty(document.id), false, "the buffer is clean again");
});

test("(b2) an unmount that is NOT a close still keeps the store's copy current", async () => {
	const path = "/tmp/switch-away.md";
	openCase(path, "one\n");
	const document = openedDocument(path, "one\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);
	mountEditor(document);
	proposeBuffer(document.id, "the reader's words");
	fileMoves(path, "external\n", 200);
	await saveBuffer(document.id); // refused: the file moved on under the reader

	// A tab switch: the viewer unmounts, and the document stays open and listed.
	await settleAfter(document.id);

	assert.equal(open().files.length, 1, "the document is still open");
	assert.equal(
		open().files[0].content,
		"the reader's words",
		"the store's copy of an OPEN document carries the buffer's words (R4-7)",
	);
	assert.equal(
		rendered()[0].content,
		"the reader's words",
		"and so does what the canvas renders",
	);
});

// -------------------------------------------------------- (c) the held close

test("(c) a close whose write was refused keeps the words, and opening the path again puts them back", async () => {
	const path = "/tmp/close-held.md";
	const bridge = openCase(path, "one\n");
	const document = openedDocument(path, "one\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);
	mountEditor(document);
	proposeBuffer(document.id, "the reader's words");
	fileMoves(path, "external\n", 200);

	closeTab(document.id);
	await settleAfter(document.id);

	assert.deepEqual(bridge.writes, [], "a held document is never written over");
	assert.deepEqual(
		[open().files.length, open().openTabs.length],
		[0, 0],
		"the tab closed, and stays closed",
	);
	assert.equal(
		bufferText(document.id),
		"the reader's words",
		"the words are not discarded",
	);
	assert.equal(bufferIsDirty(document.id), true);
	assert.equal(isAutosaveHeld(document.id), true);
	assert.equal(documentFact(document.id), "disk-changed");

	/*
	 * Open the same PATH again, the way the files grid does: it re-reads the file,
	 * so the store's copy is the file's version with the file's current mtime.
	 */
	const reopening = openedDocument(path, "external\n", 200);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, reopening);
	const shown = rendered();
	assert.equal(shown.length, 1);
	assert.equal(
		shown[0].content,
		"the reader's words",
		"the canvas renders the reader's words, not the file's version",
	);
	assert.equal(
		shown[0].readMtimeMs,
		100,
		"at the mtime those words were read from, so the file reads as moved on",
	);
	assert.equal(
		open().files[0].content,
		"external\n",
		"the store's own copy is still the file's version, not a second opinion",
	);
});

test("(c2) the projection resurrects nothing and passes an untouched document straight through", async () => {
	const path = "/tmp/close-passthrough.md";
	openCase(path, "one\n");
	const document = openedDocument(path, "one\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);

	const files = open().files;
	assert.equal(
		documentsForCanvas(files),
		files,
		"a document with nothing un-written is handed over as the store's own object",
	);
	assert.deepEqual(
		documentsForCanvas([]),
		[],
		"and an empty canvas stays empty",
	);

	mountEditor(document);
	proposeBuffer(document.id, "the reader's words");
	assert.equal(
		documentsForCanvas(files)[0].content,
		"the reader's words",
		"an OPEN document with un-written words is rendered as the reader's version",
	);

	closeTab(document.id);
	assert.deepEqual(open().files, [], "the close removed it from the open list");
	assert.deepEqual(
		documentsForCanvas(open().files),
		[],
		"and the projection only ever walks that list, so nothing comes back",
	);
	assert.equal(
		bufferText(document.id),
		"the reader's words",
		"the words are still the owner's, for the next open of this path",
	);
});

test("(c3) the projection materialises nothing: a grid's bytes are built at the write, never in a render", async () => {
	const path = "/tmp/close-grid.csv";
	openCase(path, "grid,snapshot\n");
	const document = openedDocument(path, "grid,snapshot\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);
	/*
	 * The grid surface: its buffer is a revision token plus a serialiser, because
	 * building a workbook for every cell edit is exactly the cost the buffer owner
	 * was written to avoid. So the projection must not build one either - it can only
	 * hand over bytes that were ALREADY materialised, at a save or a close.
	 */
	let builds = 0;
	adoptBuffer({
		documentId: document.id,
		path: document.path,
		text: document.content,
		token: "revision-1",
		mtimeMs: document.readMtimeMs,
		serialize: () => {
			builds += 1;
			return { text: "grid,the reader's cells\n" };
		},
		commit: portFor(document),
	});
	proposeBuffer(document.id, "revision-2");

	assert.equal(builds, 0, "nothing has been materialised for these words yet");
	documentsForCanvas(open().files);
	documentsForCanvas(open().files);
	assert.equal(builds, 0, "and a render does not build them");

	fileMoves(path, "grid,external\n", 200);
	closeTab(document.id);
	await settleAfter(document.id);
	/*
	 * The close builds them - twice, in fact, and that is the close's own existing
	 * shape rather than this test's subject: `closeBuffer` materialises the words it
	 * hands to the commit, and the flush it starts materialises the bytes it writes.
	 * What is asserted is that no RENDER adds a build of its own.
	 */
	const afterClose = builds;
	assert.ok(
		afterClose >= 1,
		`the close materialises the reader's bytes (${afterClose} build(s), at the close)`,
	);

	const reopening = openedDocument(path, "grid,external\n", 200);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, reopening);
	const shown = rendered();
	assert.equal(
		shown[0].content,
		"grid,the reader's cells\n",
		"and the projection hands those words back",
	);
	assert.equal(builds, afterClose, "without building them again");
});

// ------------------------------------- (c4) the projection's identity is stable

test("(c4) the projection's identity changes when a buffer changes, and only then", async () => {
	const path = "/tmp/close-identity.md";
	openCase(path, "one\n");
	const document = openedDocument(path, "one\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);
	const files = open().files;

	/*
	 * WHAT THIS IS FOR (agent review round 1, M2). `documentsForCanvas` runs inside
	 * `ChatContent`'s render, and its result is a prop of four memoised consumers. A
	 * fresh array and fresh document objects per CALL - which is what it returned
	 * whenever any open buffer held un-written words, i.e. while the reader was
	 * typing - re-rendered all four on every parent render. The property that fixes
	 * it is identity: the same input array and no change in the buffer registries
	 * must give back the very same output array.
	 */
	assert.equal(
		documentsForCanvas(files),
		files,
		"nothing un-written: the store's own array, by identity",
	);
	assert.equal(
		documentsForCanvas(files),
		documentsForCanvas(files),
		"and a repeat call is the same array",
	);

	mountEditor(document);
	proposeBuffer(document.id, "typed once");
	const dirty = documentsForCanvas(files);
	assert.notEqual(
		dirty,
		files,
		"un-written words are projected as their own array",
	);
	assert.equal(
		documentsForCanvas(files),
		dirty,
		"stable across every render between changes, which is what the memos need",
	);

	proposeBuffer(document.id, "typed twice");
	const next = documentsForCanvas(files);
	assert.notEqual(next, dirty, "a change to the words is a new identity");
	assert.equal(
		documentsForCanvas(files),
		next,
		"and then it is stable again until the next change",
	);

	/*
	 * The other half of the input is the store's array, which every writer replaces
	 * rather than mutates - so a cache keyed on it can never answer a store write
	 * from the previous entry.
	 */
	useCanvasStore.getState().updateOneFile(CONVERSATION, {
		...open().files[0],
		lastAgentModified: 200,
	});
	assert.notEqual(
		documentsForCanvas(open().files),
		next,
		"a store write is a new input array and is projected anew",
	);

	/* And when the words reach the file, the projection stops projecting at all. */
	assert.equal(
		(await saveBuffer(document.id)).status,
		"written",
		"the save lands",
	);
	assert.equal(
		documentsForCanvas(open().files),
		open().files,
		"a clean document goes back to being handed over as the store's own array",
	);
});

// ------------------------------------------------- (d) the promise's boundary

test("(d) the restart boundary: nothing about a closed document is persisted, and a close is not what loses the words", async () => {
	const path = "/tmp/close-restart.md";
	const bridge = openCase(path, "one\n");
	const document = openedDocument(path, "one\n", 100);
	useCanvasStore.getState().addFileAndSelect(CONVERSATION, document);
	mountEditor(document);
	proposeBuffer(document.id, "the reader's words");
	fileMoves(path, "external\n", 200);

	closeTab(document.id);
	await settleAfter(document.id);

	/*
	 * What an app restart would find. The store IS persisted, so its snapshot is
	 * exactly what a fresh process rehydrates, and the words are not in it: they
	 * are the buffer owner's module state, and the promise this file asserts is a
	 * SESSION one. Stating it here is the point of the assertion - a reader told
	 * their words survive a close must not be told, by implication, that they
	 * survive a restart.
	 */
	const snapshot = JSON.parse(persistedStore.get("canvas-store"));
	const persisted = snapshot.state.conversations[CONVERSATION];
	assert.deepEqual(
		persisted.files.filter((file) => file.id === document.id),
		[],
		"the persisted store holds no copy of a closed document",
	);
	assert.deepEqual(
		persisted.openTabs.filter((tab) => tab.id === document.id),
		[],
		"nor a tab for it",
	);

	/*
	 * AND A CLOSE IS NOT WHAT LOSES THEM. The same words on an OPEN held document
	 * are replaced by the file's version on the next freshness check after a
	 * restart, because the two registries that protect them are module state while
	 * the store's bytes are not. Measured rather than asserted in prose: a promise
	 * scoped to the session has to say what the other side of that boundary does,
	 * or "in-session" is a claim with no evidence.
	 */
	resetBuffers();
	clearDocumentDirty(document.id);
	releaseDocumentHold(document.id);
	setDocumentFact(document.id, null);
	const runner = createFreshnessRunner({
		probe: bridge.ports.probe,
		read: async (readPath) => ({
			ok: true,
			content: io.files.get(readPath).text,
		}),
	});
	const restored = { ...document, content: "the reader's words" };
	const outcome = await runner.check(restored, false);
	assert.equal(
		isDocumentDirty(document.id),
		false,
		"the fresh registry has no dirty flag for it",
	);
	assert.equal(
		"document" in outcome ? outcome.document.content : null,
		"external\n",
		"so the file's version is applied over the restored words, open case too",
	);

	setBufferPorts(null);
	resetBuffers();
});
