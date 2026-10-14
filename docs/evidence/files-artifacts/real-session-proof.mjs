// Feeds a REAL durable transcript through the SHIPPED reducer and extractor of
// the tree at cwd, and prints what the Files scanner finds. Read-only: it opens
// the transcript and writes nothing. Committed so the before/after numbers in
// `real-session-9c59d684d16b-before-after.txt` can be re-derived (agent review
// R1-4), on any session that has `generate_image` results.
//
// usage, from the root of the tree under test (the cwd is how it finds `src/`):
//   node <this file> <session-id>
// run once from an `origin/main` checkout for "before" and once from the branch
// for "after". It needs `esbuild`, which the repo already installs.
//
// What it counts: `generated_digests_with_a_row` is the figure that matters, the
// generated pictures (an image block carrying `kind` and a digest) that ended up
// with a Files row; `dot_bin_path_tiles` is the attachment-store junk tile the
// path scanner used to admit. `video_receipt_rows` counts `job_result` completion
// rows that carry the video receipt sentence; none exists on the operator's
// machine, so the video claim rests on the fixture rows the backend's own builder
// wrote, not on a live session.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const session = process.argv[2];
const bundle = await build({
	stdin: {
		contents: `
			export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { extractMentionedPaths } from "./src/renderer/src/features/chat/canonical/mentioned-files";
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
const { applyHistoryPage, EMPTY_TRANSCRIPT, extractMentionedPaths } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
const file = join(
	homedir(),
	".local-operator",
	"sessions",
	session,
	"transcript.jsonl",
);
const rows = readFileSync(file, "utf8")
	.split("\n")
	.filter((l) => l.trim())
	.map((l) => {
		try {
			return JSON.parse(l);
		} catch {
			return null;
		}
	})
	.filter((r) => r?.id && r?.payload);
const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
	entries: rows,
	has_more: false,
	cursor_missing: false,
});
const mentions = extractMentionedPaths(state.records);
const bySource = {};
for (const m of mentions) bySource[m.source] = (bySource[m.source] ?? 0) + 1;
const videoReceipts = state.records.filter(
	(r) =>
		r.kind === "custom" &&
		r.customType === "job_result" &&
		/^Video ready \u2014 job .*attached: digest\s+[0-9a-f]{32}/m.test(r.text),
);
const gen = state.records.filter(
	(r) => r.kind === "tool" && r.toolName === "generate_image",
);
const genDigests = new Set(
	gen.flatMap((r) =>
		r.images.filter((i) => i.attachment && i.kind).map((i) => i.attachment),
	),
);
const artifactDigests = new Set(
	mentions.filter((m) => m.source === "artifact").map((m) => m.artifact.digest),
);
const binTiles = mentions.filter((m) => m.path.endsWith(".bin"));
console.log(
	JSON.stringify(
		{
			session,
			rows: rows.length,
			records: state.records.length,
			generate_image_records: gen.length,
			distinct_generated_digests_in_transcript: genDigests.size,
			mentions_total: mentions.length,
			mentions_by_source: bySource,
			generated_digests_with_a_row: [...genDigests].filter((d) =>
				artifactDigests.has(d),
			).length,
			dot_bin_path_tiles: binTiles.length,
			artifact_rows: artifactDigests.size,
			video_receipt_rows: videoReceipts.length,
			sample: mentions
				.filter((m) => m.source === "artifact")
				.slice(0, 3)
				.map((m) => ({ path: m.path, ...m.artifact })),
		},
		null,
		2,
	),
);
