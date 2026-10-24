/**
 * The live user row keeps the files it was sent with.
 *
 * WHY THIS IS A TEST AND NOT A STORY. The defect is temporal, not visual: the
 * card is painted at the press and then DISAPPEARS when the owner restates the
 * message. A still cannot show a row losing a file, and the committed
 * Storybook frames are built from the record the reducer produces - the shape
 * this test pins. Reproduced from a real session: the composer's echo carried
 * the document block, the daemon's live `message_start` for the same id
 * rebuilt the row with text and images only, and the user message on screen
 * read as if nothing had been attached while the model had the file.
 *
 * The reducer is bundled from source with esbuild, the same way
 * `attachment-files.test.mjs` bundles the shipped modules, so the assertions
 * run against the code the app ships rather than a paraphrase of its rules.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export { applyEvent, appendPendingUser, EMPTY_TRANSCRIPT }
				from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { paintPendingSend, seedPendingSends }
				from "./src/renderer/src/shared/hooks/use-canonical-session";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	logLevel: "silent",
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	applyEvent,
	appendPendingUser,
	EMPTY_TRANSCRIPT,
	paintPendingSend,
	seedPendingSends,
} = mod;

const REQUEST_ID = "req-live-row-1";
const DOC = {
	id: `${REQUEST_ID}:doc:0`,
	attachment: "090915f1729670d6cbe685bb2fd41662",
	filename: "Incorporation-Constitution (1).pdf",
	mimeType: "application/pdf",
	path: "/Users/damian/Downloads/Incorporation-Constitution (1).pdf",
	storedPath:
		"/Users/damian/.local-operator/attachments/090915f1729670d6cbe685bb2fd41662.bin",
	bytes: 495028,
	injection: "native",
};

function recordOf(state) {
	const at = state.index.get(REQUEST_ID);
	return at === undefined ? undefined : state.records[at];
}

/** The frame the daemon streams for a user row it has just admitted. */
function restatingStart() {
	return {
		type: "message_start",
		message: {
			id: REQUEST_ID,
			role: "user",
			content: [
				{
					text: "I've included my articles of incorporation to confirm that we have it right too",
				},
				{
					type: "document",
					attachment: DOC.attachment,
					filename: DOC.filename,
					mime_type: DOC.mimeType,
					path: DOC.path,
					stored_path: DOC.storedPath,
					bytes: DOC.bytes,
					injection: DOC.injection,
				},
			],
		},
	};
}

test("the press paints the sent file card", () => {
	const state = appendPendingUser(
		EMPTY_TRANSCRIPT,
		REQUEST_ID,
		"I've included my articles of incorporation to confirm that we have it right too",
		[],
		1_000,
		[DOC],
	);
	assert.equal(recordOf(state)?.kind, "user");
	assert.deepEqual(recordOf(state)?.documents, [DOC]);
});

test("the owner restating the row keeps the file card on screen", () => {
	const painted = appendPendingUser(
		EMPTY_TRANSCRIPT,
		REQUEST_ID,
		"I've included my articles of incorporation to confirm that we have it right too",
		[],
		1_000,
		[DOC],
	);
	const restated = applyEvent(painted, restatingStart(), 2_000);
	const record = recordOf(restated);
	assert.equal(record?.kind, "user");
	// The row is still the optimistic echo's record: the restatement coalesces
	// rather than adding a second bubble.
	assert.equal(
		restated.records.length,
		1,
		"the restating frame must coalesce onto the painted row, not add one",
	);
	assert.deepEqual(
		record?.documents,
		[DOC],
		"the restated row must keep the document block it was sent with",
	);
	// `local` clears (delivery) and the hold stays, as the resolver's rules say;
	// neither is what this test is about, but a restatement that changed them
	// would still have to keep the file.
	assert.notEqual(record?.local, true);
});

test("a replayed restatement on an empty transcript paints its own file", () => {
	// The reconnect case: the frame is replayed onto an empty transcript, so it
	// must paint the card from its own content with no echo to carry it.
	const restated = applyEvent(EMPTY_TRANSCRIPT, restatingStart(), 2_000);
	const record = recordOf(restated);
	assert.equal(record?.kind, "user");
	assert.deepEqual(record?.documents, [DOC]);
});

test("a text-only restatement does not invent a file", () => {
	const painted = appendPendingUser(
		EMPTY_TRANSCRIPT,
		REQUEST_ID,
		"hello",
		[],
		1_000,
		[],
	);
	const restated = applyEvent(
		painted,
		{
			type: "message_start",
			message: { id: REQUEST_ID, role: "user", content: [{ text: "hello" }] },
		},
		2_000,
	);
	assert.equal(recordOf(restated)?.documents, undefined);
});

test("a restatement that carries no document block keeps the press's file", () => {
	// Some frames restate a row with text alone (an older runtime, or a
	// projection that drops the block). The echo's list is what keeps the card;
	// without `previous` this test loses it.
	const painted = appendPendingUser(
		EMPTY_TRANSCRIPT,
		REQUEST_ID,
		"I've included my articles of incorporation to confirm that we have it right too",
		[],
		1_000,
		[DOC],
	);
	const restated = applyEvent(
		painted,
		{
			type: "message_start",
			message: {
				id: REQUEST_ID,
				role: "user",
				content: [
					{
						text: "I've included my articles of incorporation to confirm that we have it right too",
					},
				],
			},
		},
		2_000,
	);
	assert.deepEqual(recordOf(restated)?.documents, [DOC]);
});

test("a restatement that names a different file replaces the card", () => {
	// The frame is the owner's statement: when it carries its own blocks they
	// win over the echo's, or a renamed/replaced file would keep painting the
	// old name. This is the other half of the merge rule.
	const painted = appendPendingUser(
		EMPTY_TRANSCRIPT,
		REQUEST_ID,
		"I've included my articles of incorporation to confirm that we have it right too",
		[],
		1_000,
		[DOC],
	);
	const OTHER = {
		...DOC,
		filename: "Renamed-Constitution.pdf",
		attachment: "ffffffffffffffffffffffffffffffff",
	};
	const restated = applyEvent(
		painted,
		{
			type: "message_start",
			message: {
				id: REQUEST_ID,
				role: "user",
				content: [
					{
						text: "I've included my articles of incorporation to confirm that we have it right too",
					},
					{
						type: "document",
						attachment: OTHER.attachment,
						filename: OTHER.filename,
						mime_type: OTHER.mimeType,
						path: OTHER.path,
						bytes: OTHER.bytes,
					},
				],
			},
		},
		2_000,
	);
	const documents = recordOf(restated)?.documents;
	assert.equal(documents?.length, 1);
	assert.equal(documents?.[0]?.filename, "Renamed-Constitution.pdf");
});

test("a pane that mounts mid-send seeds the row WITH its file", () => {
	// The identity flip after a New chat creates the session remounts the pane;
	// `seedPendingSends` is what its first frame paints.
	const identity = "draft:seed-case";
	paintPendingSend(identity, {
		id: REQUEST_ID,
		text: "I've included my articles of incorporation to confirm that we have it right too",
		images: [],
		documents: [DOC],
	});
	const seeded = seedPendingSends(identity, EMPTY_TRANSCRIPT);
	const record = recordOf(seeded);
	assert.equal(record?.kind, "user");
	assert.deepEqual(record?.documents, [DOC]);
});
