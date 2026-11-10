import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The renderer's line diff (`shared/lib/text-diff.ts`), the model behind
 * <UnifiedDiff> on profile proposals and the hub preview.
 *
 *     node --test scripts/text-diff.test.mjs
 *
 * WHAT IT PINS: that applying the ops reproduces the after text exactly (the
 * property a diff can never get wrong, checked on random edits), git's hunk
 * order (removals before additions), word-level highlights on an edited line
 * and none on a rewritten one, context folding and its edges, and the bounded
 * fallbacks that keep a huge paste from stalling the renderer.
 *
 * WHAT IT DOES NOT PROVE: that anything renders - `unified-diff-dom.test.mjs`
 * and the Storybook frames on the pull request do.
 */

const bundle = await build({
	entryPoints: ["src/renderer/src/shared/lib/text-diff.ts"],
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	diffModel,
	diffSequence,
	wordSegments,
	MAX_EDIT_DISTANCE,
	MAX_WORD_TOKENS,
} = mod;

/** Rebuild both sides from the model's lines - a diff must round-trip. */
function sides(model) {
	const before = [];
	const after = [];
	for (const block of model.blocks)
		for (const line of block.lines) {
			if (line.kind !== "add") before.push(line.text);
			if (line.kind !== "del") after.push(line.text);
		}
	return { before: before.join("\n"), after: after.join("\n") };
}

test("identical text: no changes, nothing folded into a change", () => {
	const text = "one\ntwo\nthree";
	const model = diffModel(text, text);
	assert.equal(model.identical, true);
	assert.equal(model.changes, 0);
	assert.equal(model.added, 0);
	assert.equal(model.removed, 0);
	assert.deepEqual(sides(model), { before: text, after: text });
});

test("add-only and delete-only count every line", () => {
	const added = diffModel("", "a\nb\nc");
	assert.equal(added.added, 3);
	assert.equal(added.removed, 0);
	assert.equal(added.changes, 1);
	assert.deepEqual(
		added.blocks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo]),
		[
			["add", null, 1],
			["add", null, 2],
			["add", null, 3],
		],
	);
	const removed = diffModel("a\nb\nc", "");
	assert.equal(removed.removed, 3);
	assert.equal(removed.added, 0);
});

test("a hunk prints removals before additions, with stable line numbers", () => {
	const model = diffModel("a\nb\nc\nd", "a\nB\nC\nd");
	const change = model.blocks.find((b) => b.kind === "change");
	assert.deepEqual(
		change.lines.map((l) => `${l.kind}:${l.oldNo ?? "-"}:${l.newNo ?? "-"}`),
		["del:2:-", "del:3:-", "add:-:2", "add:-:3"],
	);
});

test("an edited line gets word highlights on exactly the changed words", () => {
	const model = diffModel(
		"Keep replies short and direct.",
		"Keep replies concise and direct.",
	);
	const [del, add] = model.blocks[0].lines;
	assert.deepEqual(
		del.segments.filter((s) => s.changed).map((s) => s.text),
		["short"],
	);
	assert.deepEqual(
		add.segments.filter((s) => s.changed).map((s) => s.text),
		["concise"],
	);
	assert.equal(del.segments.map((s) => s.text).join(""), del.text);
	assert.equal(add.segments.map((s) => s.text).join(""), add.text);
});

test("a rewritten line gets no word highlight (it would mark every word)", () => {
	const words = wordSegments("alpha beta gamma", "completely different words");
	assert.equal(words, null);
	const model = diffModel("alpha beta gamma", "completely different words");
	assert.equal(model.blocks[0].lines[0].segments, undefined);
});

test("wordLevel: false draws no segments", () => {
	const model = diffModel("one two", "one three", { wordLevel: false });
	for (const line of model.blocks[0].lines)
		assert.equal(line.segments, undefined);
});

test("unchanged lines far from a change fold into a gap; context lines stay", () => {
	const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
	const after = [...before];
	after[14] = "line 15 changed";
	const model = diffModel(before.join("\n"), after.join("\n"), { context: 3 });
	assert.deepEqual(
		model.blocks.map((b) => [b.kind, b.lines.length]),
		[
			["gap", 11],
			["context", 3],
			["change", 2],
			["context", 3],
			["gap", 12],
		],
	);
	assert.deepEqual(sides(model), {
		before: before.join("\n"),
		after: after.join("\n"),
	});
});

test("a one-line fold is shown rather than offered as a button", () => {
	const before = ["a", "b", "c", "d", "e", "x", "f", "g", "h", "i", "j"];
	const after = ["a", "b", "c", "d", "e", "y", "f", "g", "h", "i", "j"];
	// context 4: lines a and j are the only ones out of reach, one each side.
	const model = diffModel(before.join("\n"), after.join("\n"), { context: 4 });
	assert.equal(
		model.blocks.some((b) => b.kind === "gap"),
		false,
	);
});

test("random edits always round-trip", () => {
	let seed = 7;
	const rand = (n) => {
		seed = (seed * 1103515245 + 12345) % 2 ** 31;
		return seed % n;
	};
	for (let run = 0; run < 200; run++) {
		const base = Array.from({ length: rand(25) }, () => `w${rand(6)}`);
		const edited = [...base];
		for (let e = 0; e < rand(6); e++) {
			const at = rand(edited.length + 1);
			if (rand(2)) edited.splice(at, 1);
			else edited.splice(at, 0, `n${rand(4)}`);
		}
		const model = diffModel(base.join("\n"), edited.join("\n"), {
			context: rand(4),
		});
		assert.deepEqual(sides(model), {
			before: base.join("\n"),
			after: edited.join("\n"),
		});
		const ops = diffSequence(base, edited);
		const kept = ops.filter((op) => op.kind === "context").length;
		assert.equal(model.added, edited.length - kept);
		assert.equal(model.removed, base.length - kept);
	}
});

test("an edit distance past the bound degrades to a full replacement, still correct", () => {
	const n = MAX_EDIT_DISTANCE + 50;
	const before = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
	const after = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");
	const started = Date.now();
	const model = diffModel(before, after);
	assert.ok(Date.now() - started < 5000, "bounded diff finished promptly");
	assert.equal(model.removed, n);
	assert.equal(model.added, n);
	assert.deepEqual(sides(model), { before, after });
});

test("a one-word edit inside a long line still highlights (D3: cap applies after trimming common ends)", () => {
	const words = Array.from({ length: 250 }, (_, i) => `word${i}`);
	const before = words.join(" ");
	const edited = [...words];
	edited[125] = "changed";
	const segments = wordSegments(before, edited.join(" "));
	assert.ok(segments, "a 250-word line with one edit keeps its highlight");
	assert.deepEqual(
		segments.before.filter((s) => s.changed).map((s) => s.text),
		["word125"],
	);
	assert.deepEqual(
		segments.after.filter((s) => s.changed).map((s) => s.text),
		["changed"],
	);
	// The bound still holds where it matters: a differing MIDDLE over the cap.
	const wide = Array.from({ length: MAX_WORD_TOKENS + 10 }, (_, i) => `a${i}`);
	const other = wide.map((w, i) => (i % 2 ? `b${i}` : w));
	assert.equal(wordSegments(wide.join(" "), other.join(" ")), null);
});
