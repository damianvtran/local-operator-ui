/** Pure wire/layout controls: no Electron, no filesystem probes, no copied algorithms. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const bundle = await build({
	stdin: {
		contents: `
 export * from "./src/renderer/src/features/chat/components/canvas/finder-layout";
 export { buildFileRows } from "./src/renderer/src/features/chat/components/canvas/file-rows";
 export { indexedDocument, mergeFilesPage } from "./src/renderer/src/features/chat/canonical/session-files";
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
	DEFAULT_FINDER,
	finderSections,
	layoutFinder,
	finderWindow,
	finderNeighbor,
	sortFinder,
	sanitizeFinderPreferences,
	buildFileRows,
	indexedDocument,
	mergeFilesPage,
	desktopEndpoint,
	desktopRequestSchema,
} = api;
const record = (i, kind = "image") => ({
	id: i.toString(16).padStart(16, "0"),
	ref: {
		type: "artifact",
		digest: i.toString(16).padStart(32, "0"),
		content_type: "image/png",
	},
	name: `file-${i}.png`,
	kind,
	session: { id: "aaaaaaaaaaaa", role: "subagent", child_id: "bbbbbbbbbbbb" },
	size_bytes: i,
	created_at: 1,
	modified_at: 2,
	first_seq: i,
	highlighted: false,
	exists: true,
});
const itemsOf = (records) =>
	buildFileRows(records.map((r) => indexedDocument(r, "aaaaaaaaaaaa"))).map(
		(row, i) => ({
			row,
			highlighted: records[i].highlighted,
			why: records[i].highlight_why ?? "",
			created: records[i].created_at,
			modified: records[i].modified_at,
			mentioned: i,
		}),
	);
test("child attachment ownership and backend identity survive the document projection", () => {
	const doc = indexedDocument(record(1), "aaaaaaaaaaaa");
	assert.equal(doc.id, "artifact:00000000000000000000000000000001");
	assert.equal(doc.indexedFileId, "0000000000000001");
	assert.equal(doc.artifact.sessionId, "aaaaaaaaaaaa");
	assert.equal(doc.artifact.childId, "bbbbbbbbbbbb");
	assert.equal(doc.path, "artifact:00000000000000000000000000000001");
});
test("revision reset replaces every former row, while same-revision pagination deduplicates", () => {
	const one = record(1);
	const two = record(2);
	assert.deepEqual(
		mergeFilesPage([one], { revision: 2, cursor_reset: true, rows: [two] }, 1),
		[two],
	);
	assert.deepEqual(
		mergeFilesPage(
			[one],
			{ revision: 1, cursor_reset: false, rows: [one, two] },
			1,
		),
		[one, two],
	);
	assert.deepEqual(
		mergeFilesPage([one], { revision: 2, cursor_reset: false, rows: [two] }, 1),
		[two],
	);
});
test("Highlights precede collapsed working files with no duplicated members; narrowing opens the fold", () => {
	const records = [
		{ ...record(1), highlighted: true, highlight_why: "Deliverable" },
		record(2),
	];
	const items = itemsOf(records);
	const closed = finderSections(items, DEFAULT_FINDER, false, new Set());
	assert.deepEqual(
		closed.map((s) => s.id),
		["Highlights", "Working files"],
	);
	const filtered = finderSections(items, DEFAULT_FINDER, true, new Set());
	assert.deepEqual(
		filtered.map((s) => s.id),
		["Highlights", "Working files", "Images"],
	);
	assert.equal(filtered.flatMap((s) => s.items).length, 2);
});
test("a sound row gets a Sounds section and an audio band; images and videos keep theirs", () => {
	/*
	 * The sound phase's Files seat: `row.kind === "audio"` gets its own section
	 * (never merged into Other) and its own band kind, because a sound's row
	 * carries a compact player rather than a name-only row. The other two media
	 * kinds are asserted beside it so the addition cannot have displaced them.
	 */
	const items = itemsOf([
		record(1, "audio"),
		record(2, "video"),
		record(3, "image"),
	]);
	const grouped = finderSections(items, DEFAULT_FINDER, false, new Set());
	assert.deepEqual(
		grouped.map((section) => section.id),
		["Images", "Videos", "Sounds"],
		"the section list keeps the grouped order, with Sounds beside the other media",
	);
	const layout = layoutFinder(grouped, 600, true);
	const bands = layout.bands.filter((band) => band.kind !== "header");
	assert.deepEqual(
		bands.map((band) => band.kind),
		["tiles", "video", "audio"],
		"each media section keeps its own band kind",
	);
	const audioBand = bands[2];
	assert.equal(audioBand.items.length, 1);
	assert.equal(
		audioBand.height,
		80,
		"one fixed transport row - no per-item measuring",
	);
	// A closed Sounds section draws its header and no band: the fold hides the
	// SOUND, not the fact that the section exists.
	const folded = finderSections(
		items,
		DEFAULT_FINDER,
		false,
		new Set(["Sounds"]),
	);
	const foldedLayout = layoutFinder(folded, 600, true);
	assert.equal(
		foldedLayout.bands.some((band) => band.kind === "audio"),
		false,
	);
	assert.equal(
		foldedLayout.bands.filter((band) => band.kind === "header").length,
		3,
	);
});

test("an audio artifact projects to kind audio, and its row names the media fact", () => {
	// The wire's row kind decides the projection (and therefore the section);
	// a digest-backed sound carries its content type and duration across.
	const sound = {
		...record(9, "audio"),
		ref: {
			type: "artifact",
			digest: "c".repeat(32),
			content_type: "audio/mpeg",
		},
		duration_s: 4.25,
	};
	const document = indexedDocument(sound, "aaaaaaaaaaaa");
	assert.equal(document.type, "audio");
	assert.equal(document.artifact.kind, "audio");
	assert.equal(document.artifact.contentType, "audio/mpeg");
	assert.equal(document.artifact.durationS, 4.25);
	const rows = buildFileRows([document]);
	assert.equal(rows[0].kind, "audio");
	assert.equal(
		rows[0].media,
		"audio",
		"the media fact routes the row to the player seat",
	);
});

test("5000 mixed items mount a bounded window at first/middle/last, with focused target pinned", () => {
	const records = Array.from({ length: 5000 }, (_, i) =>
		record(i + 1, i % 4 === 0 ? "video" : i % 4 === 1 ? "text" : "image"),
	);
	const items = itemsOf(records);
	const sections = finderSections(
		items,
		{ ...DEFAULT_FINDER, workingOpen: true },
		false,
		new Set(),
	);
	for (const width of [400, 560, 1200]) {
		const layout = layoutFinder(sections, width, true);
		for (const top of [0, layout.height / 2, layout.height - 700]) {
			const indices = finderWindow(layout, top, 700, null);
			const mounted = indices.reduce(
				(n, i) => n + layout.bands[i].items.length,
				0,
			);
			assert.ok(mounted <= 120, `${width}: ${mounted}`);
		}
		const last = items.at(-1).row.document.id;
		const pin = layout.positions.get(last);
		assert.ok(finderWindow(layout, 0, 700, last).includes(pin.band));
	}
});
test("tile geometry and row/column keyboard destinations come from the same layout", () => {
	const items = itemsOf(Array.from({ length: 8 }, (_, i) => record(i + 1)));
	const layout = layoutFinder(
		finderSections(items, DEFAULT_FINDER, false, new Set()),
		400,
		true,
	);
	assert.equal(layout.columns, 2);
	const id = items[0].row.document.id;
	assert.equal(
		finderNeighbor(layout, id, "ArrowRight", 700),
		items[1].row.document.id,
	);
	assert.equal(
		finderNeighbor(layout, id, "ArrowDown", 700),
		items[2].row.document.id,
	);
	assert.equal(
		finderNeighbor(layout, id, "End", 700),
		items[7].row.document.id,
	);
});
test("unknown metrics sort last in either direction; corrupt persisted preferences fail closed", () => {
	const items = itemsOf([record(1), record(2)]);
	items[0].modified = null;
	for (const order of ["asc", "desc"])
		assert.equal(
			sortFinder(items, { ...DEFAULT_FINDER, sort: "modified", order }).at(-1),
			items[0],
		);
	const clean = sanitizeFinderPreferences({
		sort: "evil",
		order: "sideways",
		kinds: ["images", "images", "wat"],
		group: "true",
	});
	assert.deepEqual(clean, { ...DEFAULT_FINDER, kinds: ["images"] });
});
test("narrowing opens collapsed Highlights and kind sections without erasing saved folds", () => {
	const items = itemsOf([{ ...record(1), highlighted: true }, record(2)]);
	const folds = new Set(["Highlights", "Images"]);
	const sections = finderSections(items, DEFAULT_FINDER, true, folds);
	assert.ok(sections.every((section) => section.open));
	assert.equal(sections.flatMap((section) => section.items).length, 2);
	assert.equal(folds.size, 2);
});
test("Page keys clamp at global focusable boundaries instead of dead-ending", () => {
	const items = itemsOf(
		Array.from({ length: 100 }, (_, i) => record(i + 1, "text")),
	);
	const layout = layoutFinder(
		finderSections(items, DEFAULT_FINDER, false, new Set()),
		400,
		true,
	);
	const first = items[0].row.document.id;
	const last = items.at(-1).row.document.id;
	assert.equal(
		finderNeighbor(layout, items[3].row.document.id, "PageUp", 700),
		first,
	);
	assert.equal(
		finderNeighbor(layout, items[95].row.document.id, "PageDown", 700),
		last,
	);
});

test("index/materialise ops are encoded routes and invalid artifact IDs are rejected", () => {
	const sid = "aaaaaaaaaaaa";
	const result = desktopEndpoint({
		op: "sessions.files",
		sessionId: sid,
		cursor: "revision+opaque/",
		sort: "size",
		order: "desc",
	});
	assert.equal(result.method, "GET");
	assert.match(result.path, /cursor=revision%2Bopaque%2F/);
	assert.equal(
		desktopEndpoint({
			op: "sessions.files.materialise",
			sessionId: sid,
			fileId: "123456789abcdef0",
		}).path,
		`/v1/desktop/sessions/${sid}/files/123456789abcdef0/materialise`,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.files.materialise",
			sessionId: sid,
			fileId: "../escape",
		}).success,
		false,
	);
});
