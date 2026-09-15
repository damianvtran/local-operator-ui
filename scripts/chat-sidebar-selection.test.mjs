/**
 * The chat sidebar's current-row ground, executable.
 *
 *     node --test scripts/chat-sidebar-selection.test.mjs
 *
 * The operator's report was "the sidebar doesn't visibly highlight the selected
 * conversation, so you can't tell from the sidebar which one is selected". The
 * panel is `bg-surface`; the ground every current-row state used was
 * `accent-wash`, which is ΔE00 1.05 from `surface` in tokyoNight — no mark at
 * all — while the hover step the same rows carry measures 4.58 there, so the
 * pointer read as the current row and the current row did not.
 *
 * THREE THINGS THIS FILE ASSERTS, AND WHY EACH NEEDS ITS OWN INSTRUMENT:
 *
 *   1. the GROUND the current row paints is a step off the panel, not a wash —
 *      read off the shipped class strings, because no palette assertion can see
 *      a class and every one of them stayed green while this shipped;
 *   2. the ground SURVIVES the pointer — asserted by running the shipped `cn`
 *      over the shipped `rowStyle` and the shipped `rowCurrent`, because the
 *      property is a tailwind-merge resolution (the two `hover:bg-*` land in one
 *      conflict group and the later wins) and a string comparison cannot see it.
 *      Reordering the arguments, or dropping the `hover:` half, turns this red;
 *   3. every current-row state in the panel takes the SAME ground — the four
 *      call sites are one fact and a fix that marks only the selected
 *      conversation leaves `All chats`, `New chat` and the entity row painting
 *      an invisible state beside it.
 *
 * WHAT IT CANNOT PROVE: that the ground is *visible*. That is a property of the
 * role pair across twelve palettes, and it is `scripts/contrast-contract.mjs`'s
 * job — `["surface", "sunken"]` and `["elevated", "sunken"]` are asserted there
 * at the field floor of ΔE00 2.0, with `sunken`'s worst case at 3.75. It also
 * cannot prove the row reads as the current one on screen; that is the frames in
 * `docs/evidence/chat-sidebar-selection/`.
 *
 * PROCEDURE NOTE. `rowStyle` and `rowCurrent` are read as source TEXT rather
 * than imported, because the sidebar cannot be rendered in isolation (it reads
 * the router, the canonical-sessions store and the desktop capability hooks) and
 * this repository's desktop suite has no DOM harness. The strings are then fed
 * to the REAL `cn`, so the merge under test is the one the component runs. The
 * comment scanner below is the one in `scripts/new-chat-row.test.mjs`: comments
 * have to come out before class literals are read, or a note explaining the
 * ground re-arms a pin (that file records the round it bit).
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const source = readFileSync(join(ROOT, SIDEBAR), "utf8");

/*
 * React stays out of this bundle and so does every package: `packages:
 * "external"` keeps bare specifiers bare, which is why the bundle is written to
 * a real file rather than handed to `import()` as a `data:` URL — nothing
 * resolves a bare specifier from a data URL. From `node_modules/.cache/` it
 * resolves what this process resolves, to the same paths, so `cn` here is the
 * `cn` the renderer ships.
 */
const CACHE = join(ROOT, "node_modules/.cache/chat-sidebar-selection");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const { cn } = await bundleInto(
	"utils",
	`export { cn } from "./src/renderer/src/shared/lib/utils";`,
);

/**
 * Strip `//` and comment-block comments, outside string literals.
 *
 * A scanner rather than two `replace()` passes because a slice can legitimately
 * contain a `//` inside a quoted string, and a regular expression cannot tell
 * that from the start of a comment.
 */
const stripComments = (text) => {
	let out = "";
	let quote = null;
	for (let i = 0; i < text.length; ) {
		const char = text[i];
		const next = text[i + 1];
		if (quote) {
			if (char === "\\") {
				out += text.slice(i, i + 2);
				i += 2;
				continue;
			}
			if (char === quote) quote = null;
			out += char;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			i += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
			i += 2;
			continue;
		}
		out += char;
		i += 1;
	}
	return out;
};

const code = stripComments(source);

/** The quoted class string a `const NAME = "..."` declaration carries. */
const literalOf = (name) => {
	const at = code.indexOf(`const ${name} =`);
	assert.notEqual(at, -1, `chat-sidebar.tsx no longer declares \`${name}\``);
	const match = code.slice(at, code.indexOf(";", at)).match(/"([^"]*)"/);
	assert.notEqual(
		match,
		null,
		`\`${name}\` is no longer a plain class literal, so this file cannot read it and the ground is no longer pinned anywhere`,
	);
	return match[1];
};

const rowStyle = literalOf("rowStyle");
const rowCurrent = literalOf("rowCurrent");

/** Every quoted class literal in the file, comments removed. */
const classLiterals = [
	...code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g),
].map((match) => match[1]);

/** The `className={cn(...)}` expression of one row, by the text that finds it. */
const classExpressionFor = (anchor) => {
	const at = source.indexOf(anchor);
	assert.notEqual(at, -1, `no row matches ${JSON.stringify(anchor)}`);
	/* BACKWARDS from the anchor: an anchor can sit inside the expression, and a
	   forward search would then take the NEXT row's `className` — which reads as
	   a passing assertion about the wrong element. */
	const start = source.lastIndexOf("className={cn(", at);
	assert.notEqual(start, -1, `${anchor} has no cn() class expression`);
	const end = source.indexOf(")}", start);
	return stripComments(source.slice(start + "className={cn(".length, end));
};

const sessionRowClasses = classExpressionFor(
	"selectedConversation === row.session_id",
);
const allChatsClasses = classExpressionFor(">All chats</span>");
const newChatClasses = classExpressionFor(">New chat</span>");
const entityRowClasses = classExpressionFor("draft?.target?.kind === kind");

test("the current row's ground is a step off the panel, not a wash", () => {
	assert.ok(
		rowCurrent.includes("bg-sunken"),
		`the current row's ground must be a step of its own; \`sunken\` is ΔE00 3.75 from \`surface\` at its worst (iceberg) against the 2.0 field floor. Got:\n${rowCurrent}`,
	);
	assert.ok(
		!rowCurrent.includes("bg-accent-wash"),
		`\`accent-wash\` is ΔE00 1.05 from the panel ground in tokyoNight — the defect this row was reported for. Got:\n${rowCurrent}`,
	);
	assert.ok(
		rowCurrent.includes("text-ink"),
		`the ground is a ground for text, and \`ink\` is the role whose 7:1 floor \`sunken\` is asserted on. Got:\n${rowCurrent}`,
	);
});

test("the current row's ground does not move under the pointer", () => {
	const merged = cn(rowStyle, "w-full text-left", rowCurrent);
	assert.ok(
		merged.includes("hover:bg-sunken"),
		`the pointer must land on the row's own ground, not a different one:\n${merged}`,
	);
	assert.ok(
		!merged.includes("hover:bg-elevated"),
		`\`rowStyle\`'s hover step survived the merge, so hovering the row the user is ON would replace its ground with the hover ground — ΔE00 0.77 apart in obsidian, i.e. the selection erased:\n${merged}`,
	);
	/*
	 * And the control, without which the assertion above could pass by the step
	 * simply being gone everywhere: a row that is NOT current still gets the
	 * pointer's step. Both halves are the same property seen from two sides.
	 */
	const plain = cn(rowStyle, "w-full text-left");
	assert.ok(
		plain.includes("hover:bg-elevated"),
		`the hover step must still mark rows that are not current:\n${plain}`,
	);
	/*
	 * The merge is load-bearing rather than incidental, stated so a later reader
	 * cannot "fix" this by deleting `hover:bg-sunken`: the raw concatenation the
	 * browser would see WITHOUT `cn` carries both rules, and `hover:bg-elevated`
	 * wins on cascade order. This is the mechanism, asserted, not described.
	 */
	assert.ok(
		`${rowStyle} ${rowCurrent}`.includes("hover:bg-elevated"),
		"the raw class strings no longer both carry a hover rule, so this test is no longer measuring tailwind-merge",
	);
});

test("every current-row state in the panel takes the shared ground", () => {
	for (const [what, classes] of [
		["the selected conversation", sessionRowClasses],
		["the All chats filter", allChatsClasses],
		["the New chat row", newChatClasses],
		["the entity row staging a draft", entityRowClasses],
	]) {
		assert.ok(
			classes.includes("rowCurrent"),
			`${what} no longer takes the shared current-row ground:\n${classes}`,
		);
	}
	const washes = classLiterals.filter((literal) =>
		literal.includes("bg-accent-wash"),
	);
	assert.deepEqual(
		washes,
		[],
		`a class literal in this panel is back on the wash, which is invisible on \`surface\` in four of twelve themes and nearly so in the rest (tokyoNight ΔE00 1.05): ${JSON.stringify(washes)}`,
	);
});

test("the selected row's mark and its aria-current read the same terms", () => {
	const at = source.indexOf("aria-current={");
	assert.notEqual(at, -1, "the session row has no aria-current");
	const ariaCurrent = source.slice(at, source.indexOf("}", source.indexOf("?", at)));
	/*
	 * Both halves of the predicate, on both sides of the fact: a row that paints
	 * a ground the accessibility tree does not claim misreports where the user is
	 * for a screen reader, and one that claims a ground it does not paint does it
	 * for everyone else. The two terms are what `!activeDraftKey` is doing here —
	 * a staged draft owns the current-row mark instead.
	 */
	for (const term of ["selectedConversation === row.session_id", "!activeDraftKey"]) {
		assert.ok(
			ariaCurrent.includes(term),
			`aria-current no longer reads \`${term}\`, so it and the row's ground can disagree:\n${ariaCurrent}`,
		);
		assert.ok(
			sessionRowClasses.includes(term),
			`the session row's ground no longer reads \`${term}\`, so it and aria-current can disagree:\n${sessionRowClasses}`,
		);
	}
});
