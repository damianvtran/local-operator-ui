/**
 * The canvas Attachments section's pure model: merge, dedupe, counts, layout.
 *
 *     node --test scripts/user-attachments.test.mjs
 *
 * No Electron and no DOM: the modules are bundled with esbuild exactly as
 * `finder-files.test.mjs` does, so these tests exercise the shipped functions
 * rather than copies. Wire shapes are the backend's real items
 * (`GET .../user-attachments`, measured on session 519d73620f7b 2026-10-27).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
 export * from "./src/renderer/src/features/chat/canonical/user-attachments";
 export * from "./src/renderer/src/features/chat/components/canvas/attachment-items";
 export { finderSections, layoutFinder, DEFAULT_FINDER, ATTACHMENTS_SECTION } from "./src/renderer/src/features/chat/components/canvas/finder-layout";
 export { imageActions } from "./src/renderer/src/features/chat/utils/image-actions";
 export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@features": "./src/renderer/src/features",
		"@shared": "./src/renderer/src/shared",
	},
});
const api = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	mergeUserAttachments,
	attachmentFinderItems,
	withoutAttached,
	combinedFileCount,
	finderSections,
	layoutFinder,
	DEFAULT_FINDER,
	ATTACHMENTS_SECTION,
	imageActions,
	desktopEndpoint,
	desktopRequestSchema,
} = api;

const PDF = "894b00b1b8535352f0b5ee73063d7661";
const SHOT = "ec18e8fa93ec9e1bf7eacbfa9a5cae99";
const pdfWire = {
	message_id: "23ca2c42-1f3c-4edb-ab47-584bf3f1d67a",
	ts: 1793117262.985848,
	index: 1,
	kind: "document",
	attachment: PDF,
	filename: "IP Assignment eSignature.pdf",
	mime_type: "application/pdf",
	bytes: 293421,
	path: "/Users/x/Downloads/IP Assignment eSignature.pdf",
	exists: true,
	stored_path: `/Users/x/.local-operator/attachments/${PDF}.bin`,
	stored: true,
	injection: "native",
};
const shotWire = {
	message_id: "m2",
	ts: 1793117300,
	index: 1,
	kind: "image",
	attachment: SHOT,
	filename: null,
	mime_type: "image/png",
	bytes: 65276,
	path: null,
	exists: null,
	stored: true,
};
const userRecord = (id, ts, { documents = [], images = [] } = {}) => ({
	kind: "user",
	id,
	ts,
	text: "",
	images,
	documents,
});

test("a first-turn attachment from the backend survives lazy history (no loaded rows)", () => {
	const view = mergeUserAttachments(
		{ state: "ready", items: [pdfWire, shotWire], truncated: false },
		[],
	);
	assert.equal(view.complete, true);
	assert.deepEqual(
		view.items.map((i) => [i.kind, i.digest, i.availability]),
		[
			["image", SHOT, "present"],
			["document", PDF, "present"],
		],
		"newest first; both listed though no history row is loaded",
	);
	assert.equal(view.items[1].ts, Math.round(pdfWire.ts * 1000));
});

test("a live send appears before the backend re-read, and is not doubled after it", () => {
	const live = userRecord("m3", 1793117400000, {
		images: [
			{
				id: "m3:0",
				data: "iVBORw0KGgo=",
				attachment: null,
				mimeType: "image/png",
			},
		],
	});
	const before = mergeUserAttachments({ state: "ready", items: [pdfWire] }, [
		live,
	]);
	assert.equal(before.items.length, 2);
	assert.equal(
		before.items[0].availability,
		"unknown",
		"never claimed missing yet",
	);
	const after = mergeUserAttachments(
		{
			state: "ready",
			items: [
				pdfWire,
				{ ...shotWire, message_id: "m3", index: 0, ts: 1793117400 },
			],
		},
		[live],
	);
	assert.equal(
		after.items.length,
		2,
		"the stored row replaces the inline echo",
	);
	assert.equal(after.items[0].digest, SHOT);
});

test("capability absent degrades to loaded rows and says the list is partial", () => {
	const record = userRecord("u1", 5, {
		documents: [
			{
				id: "u1:doc:0",
				attachment: PDF,
				filename: "a.pdf",
				mimeType: "application/pdf",
				path: "/tmp/a.pdf",
				storedPath: null,
				bytes: 10,
			},
		],
	});
	const view = mergeUserAttachments(null, [record]);
	assert.equal(view.complete, false);
	assert.equal(view.items.length, 1);
	const unsupported = mergeUserAttachments(
		{ state: "unsupported", items: [] },
		[record],
	);
	assert.equal(unsupported.complete, false);
	assert.equal(unsupported.items.length, 1, "never an empty claim");
});

test("the three missing states are told apart", () => {
	const view = mergeUserAttachments(
		{
			state: "ready",
			items: [
				pdfWire,
				{ ...pdfWire, message_id: "r", exists: false, stored: true },
				{ ...pdfWire, message_id: "g", exists: false, stored: false },
				{ ...shotWire, message_id: "s", stored: false },
			],
		},
		[],
	);
	const by = Object.fromEntries(
		view.items.map((i) => [i.messageId, i.availability]),
	);
	assert.equal(by[pdfWire.message_id], "present");
	assert.equal(by.r, "retained", "origin moved, saved copy kept");
	assert.equal(by.g, "gone", "origin and saved copy both gone");
	assert.equal(by.s, "gone", "a pasted picture whose stored copy was pruned");
	const items = attachmentFinderItems(view.items, "abcdef123456");
	const row = (id) => items[view.items.findIndex((i) => i.messageId === id)];
	assert.equal(row("r").row.missing, false, "a retained copy is not missing");
	assert.equal(
		row("r").row.artifact?.digest,
		PDF,
		"actions ride the retained copy",
	);
	assert.equal(row("g").row.missing, true);
	assert.equal(
		row("g").row.document.path,
		pdfWire.path,
		"copy path keeps the record",
	);
	assert.equal(row("g").attachment.digest, null, "nothing to materialise");
});

test("attachments own their digests: agent rows drop the duplicate and the count counts once", () => {
	const view = mergeUserAttachments(
		{ state: "ready", items: [pdfWire, shotWire] },
		[],
	);
	const agent = [
		{ digest: SHOT },
		{ digest: "f".repeat(32) },
		{ digest: null },
	];
	const owned = new Set(view.items.map((i) => i.digest));
	assert.deepEqual(
		withoutAttached(agent, (row) => row.digest, owned).map((row) => row.digest),
		["f".repeat(32), null],
	);
	assert.equal(
		combinedFileCount(
			3,
			agent.map((row) => row.digest),
			view,
		),
		2 + 2,
		"3 agent rows minus 1 duplicate, plus 2 attachments",
	);
});

test("Attachments is pinned first, files as rows, pictures in the Images tile grid", () => {
	const view = mergeUserAttachments(
		{ state: "ready", items: [pdfWire, shotWire] },
		[],
	);
	const attachments = attachmentFinderItems(view.items, "abcdef123456");
	const sections = finderSections(
		[],
		DEFAULT_FINDER,
		false,
		new Set(),
		attachments,
	);
	assert.equal(sections[0].id, ATTACHMENTS_SECTION);
	const layout = layoutFinder(sections, 400, DEFAULT_FINDER.group);
	assert.deepEqual(
		layout.bands.map((band) => band.kind),
		["header", "compact", "tiles"],
	);
	const ungrouped = layoutFinder(sections, 400, false);
	assert.ok(
		ungrouped.bands.some((band) => band.kind === "tiles"),
		"pictures stay a grid even when grouping is off",
	);
	const pdf = attachments.find((item) => item.row.media !== "image");
	assert.equal(pdf.attachment.note, "293 KB · Oct 27", "size and when");
});

test("a pasted picture with a materialiser gets the path actions; a bare blob does not", () => {
	const blob = "blob:app://x/1";
	assert.deepEqual(
		imageActions("blob", { canShowInCanvas: false, source: blob }).map(
			(a) => a.id,
		),
		["copy-image"],
	);
	assert.deepEqual(
		imageActions("blob", {
			canShowInCanvas: true,
			source: blob,
			artifactPathActions: true,
		}).map((a) => a.id),
		[
			"show-in-canvas",
			"open-file",
			"open-folder",
			"copy-file-path",
			"copy-image",
		],
	);
});

test("the two ops encode to the backend routes and refuse a malformed digest", () => {
	const sessionId = "abcdef123456";
	assert.deepEqual(
		desktopEndpoint({ op: "sessions.userAttachments", sessionId }),
		{
			path: `/v1/desktop/sessions/${sessionId}/user-attachments`,
			method: "GET",
		},
	);
	assert.deepEqual(
		desktopEndpoint({
			op: "sessions.userAttachments.materialise",
			sessionId,
			digest: PDF,
		}),
		{
			path: `/v1/desktop/sessions/${sessionId}/user-attachments/${PDF}/materialise`,
			method: "POST",
		},
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.userAttachments.materialise",
			sessionId,
			digest: "../../etc",
		}).success,
		false,
	);
});

test("a picture whose bytes are still inline keeps the localized attachment name", () => {
	/*
	 * Design D3: before the stored digest lands, a just-sent picture took its name
	 * from `getFileName(data:…)`, which is a hard-coded English "Pasted image" - so
	 * one tile was English in every locale and renamed itself to the localized
	 * attachment label once stored. Both arms must answer the same label.
	 */
	const inline = attachmentFinderItems(
		[
			{
				id: "m9",
				ts: 1_700_000_000_000,
				kind: "image",
				digest: null,
				data: "iVBORw0KGgo=",
				mimeType: "image/png",
				sizeBytes: 8,
				path: null,
				storedPath: null,
				exists: null,
				status: "ready",
			},
		],
		"5a4000000004",
	)[0];
	const stored = attachmentFinderItems(
		[
			{
				id: "5a4000000004:6894c4b6b992d58650d6d32ae85470d8",
				messageId: "5a4000000004",
				ts: 1_700_000_000_000,
				kind: "image",
				digest: "6894c4b6b992d58650d6d32ae85470d8",
				data: null,
				filename: null,
				mimeType: "image/png",
				bytes: 8,
				path: null,
				storedPath: null,
				availability: "present",
			},
		],
		"5a4000000004",
	)[0];
	assert.equal(inline.row.document.title, "Attached image");
	assert.equal(stored.row.document.title, inline.row.document.title);
	assert.ok(
		!inline.row.document.title.startsWith("Pasted"),
		"no hard-coded English label on the inline arm",
	);
});
