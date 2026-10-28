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
 export { finderSections, layoutFinder, DEFAULT_FINDER, ATTACHMENTS_SECTION, tileThumbHeight } from "./src/renderer/src/features/chat/components/canvas/finder-layout";
 export { attachmentMetaLine } from "./src/renderer/src/features/chat/components/attachment-file-card";
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
	tileThumbHeight,
	attachmentMetaLine,
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
	// A non-empty status keeps the list row on one sentence run, never the
	// size/date pair.
	assert.equal(
		row("r").attachment.status,
		"Moved or deleted · saved copy kept",
	);
	assert.equal(row("g").attachment.status, "Moved or deleted · no saved copy");
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
	// An empty status is what makes a list row render size and date as two
	// directional runs instead of one `<bdi>` that mirrors an RTL date.
	assert.equal(pdf.attachment.status, "", "an in-place file has no status");
	assert.deepEqual(
		[pdf.attachment.size, pdf.attachment.when],
		["293 KB", "Oct 27"],
	);
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

/*
 * PR #1452 round-4 remediation (UX R2, QA R4, review R4, design R2).
 */

const BYTES_92 = /92 B/;
const PDF_LABEL = /^PDF/;
/** The `text-meta` line box measured on the real app (design R2 D8: 17.4 px). */
const META_LINE_PX = 17.4;
/** The name line (`text-meta` too on a tile) plus the tile's `p-1` and `mb-1`. */
const TILE_CHROME_PX = 4 + 4 + 4;

test("D8: an attachment tile band holds the thumbnail AND both caption lines", () => {
	const pictures = Array.from({ length: 7 }, (_, at) => ({
		...shotWire,
		message_id: `m-${at}`,
		attachment: `${SHOT.slice(0, -2)}${String(at).padStart(2, "0")}`,
	}));
	const view = mergeUserAttachments({ state: "ready", items: pictures }, []);
	const attachments = attachmentFinderItems(view.items, "abcdef123456");
	const sections = finderSections(
		[],
		DEFAULT_FINDER,
		false,
		new Set(),
		attachments,
	);
	for (const width of [400, 440, 560]) {
		const layout = layoutFinder(sections, width, DEFAULT_FINDER.group);
		const tiles = layout.bands.filter((band) => band.kind === "tiles");
		assert.ok(tiles.length >= 2, `two rows of tiles at ${width}`);
		for (const band of tiles) {
			const thumb = tileThumbHeight(band);
			// The tile is the thumbnail, its chrome, and TWO caption lines; the
			// band (= the row pitch, bands are stacked) must hold all of it.
			const tile = thumb + TILE_CHROME_PX + 2 * META_LINE_PX;
			assert.ok(
				band.height >= tile,
				`at ${width}: row pitch ${band.height} >= tile ${tile}`,
			);
		}
		// Consecutive tile rows are stacked at exactly the band height.
		assert.equal(tiles[1].top - tiles[0].top, tiles[0].height);
	}
	// Negative control: an agent Images tile keeps its one-line geometry.
	const agentSections = [
		{
			id: "Images",
			label: "Images",
			items: attachments.map((item) => ({ ...item, attachment: undefined })),
			open: true,
			highlights: false,
		},
	];
	const agent = layoutFinder(agentSections, 440, true).bands.find(
		(band) => band.kind === "tiles",
	);
	const ours = layoutFinder(sections, 440, true).bands.find(
		(band) => band.kind === "tiles",
	);
	assert.equal(ours.height - agent.height, 18, "one extra caption line");
	assert.equal(tileThumbHeight(ours), tileThumbHeight(agent), "same thumbnail");
});

test("U14: the list states a small file's size the way the card does", () => {
	const tiny = {
		...pdfWire,
		filename: ".env",
		bytes: 92,
		mime_type: "text/plain",
	};
	const view = mergeUserAttachments({ state: "ready", items: [tiny] }, []);
	const [item] = attachmentFinderItems(view.items, "abcdef123456");
	assert.equal(item.attachment.size, "92 B");
	assert.match(attachmentMetaLine(".env", "text/plain", 92), BYTES_92);
});

test("QA n1: text/plain with no extension reads TXT, never PLAI", () => {
	assert.equal(attachmentMetaLine(".env", "text/plain", 92), "TXT · 92 B");
	assert.equal(
		attachmentMetaLine("id_rsa", "text/plain; charset=utf-8", 0),
		"TXT",
	);
	// Control: an extension still wins.
	assert.match(attachmentMetaLine("a.pdf", "application/pdf", 10), PDF_LABEL);
});

test("D10: a retained picture tile states 'Saved copy'; its row keeps the sentence", () => {
	const moved = {
		...shotWire,
		filename: "shot.png",
		path: "/Users/x/shot.png",
		exists: false,
	};
	const view = mergeUserAttachments({ state: "ready", items: [moved] }, []);
	const [item] = attachmentFinderItems(view.items, "abcdef123456");
	assert.equal(item.attachment.tileStatus, "Saved copy");
	assert.equal(item.attachment.status, "Moved or deleted · saved copy kept");
});

test("D11: a refused picture sent as a file stays a picture (tile), not a glyph row", () => {
	const refusedShot = {
		...pdfWire,
		kind: "document",
		filename: "key-screenshot.png",
		path: "/Users/x/Desktop/key-screenshot.png",
		mime_type: "image/png",
		materialisable: false,
	};
	const allowedShot = {
		...refusedShot,
		materialisable: true,
		attachment: SHOT,
	};
	const view = mergeUserAttachments(
		{ state: "ready", items: [refusedShot, allowedShot] },
		[],
	);
	const items = attachmentFinderItems(view.items, "abcdef123456");
	assert.deepEqual(
		items.map((item) => item.row.media),
		["image", "image"],
	);
	// The refused one paints by digest (no origin path is handed anywhere).
	assert.ok(
		items[0].row.document.artifact,
		"refused picture is a digest document",
	);
});

test("R4-U1: a refused row with no stored bytes is 'nothing to act on'", () => {
	const bare = {
		...pdfWire,
		attachment: null,
		filename: ".env",
		path: "/Users/x/proj/.env",
		exists: true,
		stored: false,
		stored_path: null,
		materialisable: false,
	};
	const view = mergeUserAttachments({ state: "ready", items: [bare] }, []);
	const [item] = attachmentFinderItems(view.items, "abcdef123456");
	assert.equal(item.row.document.availability, "missing");
	assert.ok(
		!item.row.document.path.includes("/"),
		"the origin path is not carried",
	);
	// Control: the same row without a refusal keeps its origin path.
	const allowed = mergeUserAttachments(
		{ state: "ready", items: [{ ...bare, materialisable: true }] },
		[],
	);
	const [open] = attachmentFinderItems(allowed.items, "abcdef123456");
	assert.equal(open.row.document.path, "/Users/x/proj/.env");
});

test("U20: dotenv-family names read TXT, never their suffix", () => {
	for (const name of [".env", ".env.production", ".env.moved", ".ENV.local"])
		assert.equal(attachmentMetaLine(name, "text/plain", 0), "TXT", name);
	// Control: a real extension and a lookalike keep their own label.
	assert.equal(attachmentMetaLine("notes.md", "text/markdown", 0), "MD");
	assert.equal(attachmentMetaLine(".envrc", "text/plain", 0), "TXT");
	assert.equal(attachmentMetaLine("prod.env", "text/plain", 0), "ENV");
});

test("U16: a refused row is present only through its saved copy", () => {
	const refused = {
		...pdfWire,
		filename: ".env",
		path: "/Users/x/proj/.env",
		exists: true,
		stored: false,
		materialisable: false,
	};
	const [gone] = mergeUserAttachments(
		{ state: "ready", items: [refused] },
		[],
	).items;
	assert.equal(gone.availability, "gone");
	const [kept] = mergeUserAttachments(
		{ state: "ready", items: [{ ...refused, stored: true }] },
		[],
	).items;
	assert.equal(kept.availability, "present");
	// Control: an allowed row with its origin in place is present without a copy.
	const [allowed] = mergeUserAttachments(
		{ state: "ready", items: [{ ...refused, materialisable: true }] },
		[],
	).items;
	assert.equal(allowed.availability, "present");
});

/*
 * PR #1452 round 6 (QA R6 Q3 / Q3b, review R6-4): the verdict is tri-state.
 * Unknown - no listing yet, or a send the listing has not judged - withholds.
 */
test("Q3: a capable backend's rows are pending until a judged listing lands", () => {
	const record = userRecord("u1", 1793117300000, {
		documents: [
			{
				id: "u1:doc:0",
				attachment: null,
				filename: "id_rsa",
				mimeType: "text/plain",
				path: "/Users/x/.ssh/id_rsa",
				storedPath: null,
				bytes: 258,
			},
		],
	});
	const block = {
		messageId: "u1",
		kind: "document",
		position: 0,
		count: 1,
		digest: null,
		path: "/Users/x/.ssh/id_rsa",
	};
	// Loading / failed / unavailable: no usable listing.
	for (const listing of [null, { state: "unavailable", items: [] }]) {
		const view = mergeUserAttachments(listing, [record], true);
		assert.equal(view.verdicts, "pending");
		assert.equal(view.items[0].materialisable, "pending");
		assert.equal(
			api.refusalVerdict(api.attachmentRefusals(view), block),
			"pending",
		);
		assert.equal(api.canMaterialiseAttachment(true, "pending"), false);
	}
	// A judged listing that has not seen this message yet (Q3b).
	const stale = mergeUserAttachments(
		{ state: "ready", items: [{ ...pdfWire, materialisable: true }] },
		[record],
		true,
	);
	assert.equal(stale.verdicts, "ready");
	assert.equal(
		api.refusalVerdict(api.attachmentRefusals(stale), block),
		"pending",
	);
	// The re-read judges it: allowed clears to null, refused is false.
	const judged = (materialisable) =>
		mergeUserAttachments(
			{
				state: "ready",
				items: [
					{
						...pdfWire,
						message_id: "u1",
						index: 0,
						attachment: null,
						filename: "id_rsa",
						path: "/Users/x/.ssh/id_rsa",
						materialisable,
					},
				],
			},
			[record],
			true,
		);
	assert.equal(
		api.refusalVerdict(api.attachmentRefusals(judged(true)), block),
		null,
	);
	assert.equal(
		api.refusalVerdict(api.attachmentRefusals(judged(false)), block),
		false,
	);
	// Controls: an older backend (not judging), a peer's conversation, and a
	// daemon that lists rows without verdicts keep the capability-only rule.
	for (const [listing, judging] of [
		[null, false],
		[{ state: "unsupported", items: [] }, true],
		[{ state: "ready", items: [{ ...pdfWire }] }, true],
	]) {
		const view = mergeUserAttachments(listing, [record], judging);
		assert.equal(view.verdicts, "none", JSON.stringify(listing));
		assert.equal(api.attachmentRefusals(view), api.NO_REFUSALS);
	}
});

test("R6-4: a slot-only refusal (no digest, no path) is kept in the index", () => {
	const pasted = {
		...pdfWire,
		message_id: "u2",
		index: 0,
		attachment: null,
		filename: "id_rsa",
		path: null,
		exists: null,
		stored: false,
		materialisable: false,
	};
	const view = mergeUserAttachments({ state: "ready", items: [pasted] }, []);
	const refusals = api.attachmentRefusals(view);
	assert.notEqual(refusals, api.NO_REFUSALS);
	assert.equal(
		api.refusalVerdict(refusals, {
			messageId: "u2",
			kind: "document",
			position: 0,
			count: 1,
			digest: null,
			path: null,
		}),
		false,
	);
});

test("Q5: a refused row with no saved copy says why it is inert, not that it moved", () => {
	const refused = {
		...pdfWire,
		filename: "server.pem",
		path: "/Users/x/proj/server.pem",
		exists: true,
		stored: false,
		materialisable: false,
	};
	const note = (over) =>
		attachmentFinderItems(
			mergeUserAttachments(
				{ state: "ready", items: [{ ...refused, ...over }] },
				[],
			).items,
			"abcdef123456",
		)[0].attachment.note;
	assert.equal(note({}), "Looks like a secret, so file actions are off");
	// No origin at all (an inline paste): nothing was moved either.
	assert.equal(
		note({ path: null, exists: null }),
		"Looks like a secret, so file actions are off",
	);
	// Control: the original really is missing - the gone sentence is true.
	assert.equal(note({ exists: false }), "Moved or deleted · no saved copy");
});
