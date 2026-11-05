/**
 * The Team Bridge sidebar column has ONE inline inset, on both sides.
 *
 * WHY THIS EXISTS. Operator report 2026-11-04: "everything from the Channels
 * header down is farther left ... than the buttons/titles above", and "the bell
 * mute icon is right up against the right with no padding". Each band of the
 * column (Back row, organization header, quick rows, sections, owner audit,
 * account foot) had chosen its own horizontal padding (`px-3` / `px-1` / none),
 * and the trailing marks each sat on their own offset. The fix routes every band
 * through `SIDEBAR_INSET` (`shared/components/navigation/sidebar-inset.ts`); this
 * test keeps it that way.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. Two layers:
 *  1. Source: every band's className names `SIDEBAR_INSET`, and none of them
 *     carries a literal `px-*` / `ps-*` / `pe-*` beside it - a second inset
 *     beside the shared one is exactly the drift that was reported.
 *  2. Computed padding: the real Tailwind v4 compiler (the repo's own pinned
 *     `tailwindcss`) turns each inset class read FROM THE SOURCE into a length,
 *     and the arithmetic per mark (band inset + the control's own padding +
 *     centring of the glyph in its box) must give 16px on the leading side and
 *     16px on the trailing side for every mark the reporter named.
 * It is not a layout engine: jsdom has no geometry. The rendered numbers are in
 * the PR (Storybook `Team Bridge/Page › In Shell Sidebar Inset`, measured with
 * the browser host's `styles`), and this pins the classes those numbers came from.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const TB = "src/renderer/src/features/team-bridge";
const NAV = "src/renderer/src/shared/components/navigation";
const page = read(`${TB}/team-bridge-page.tsx`);
const rail = read(`${TB}/team-bridge-rail.tsx`);
const audit = read(`${TB}/team-bridge-owner-audit.tsx`);
const column = read(`${TB}/team-bridge-route-column.tsx`);
const foot = read(`${NAV}/sidebar-foot.tsx`);
const inset = read(`${NAV}/sidebar-inset.ts`);

const INSET_CLASS = inset.match(/export const SIDEBAR_INSET = "([^"]+)";/)?.[1];

/** The 16px every leading mark starts at and every trailing mark ends at. */
const LINE = 16;

/*
 * Tailwind resolves a class to CSS; spacing utilities come out as
 * `calc(var(--spacing) * N)` with `--spacing: 0.25rem` in the theme, and an
 * arbitrary value comes out verbatim. Both are reduced to px here (1rem = 16px,
 * the app's root size).
 */
const { compile } = await import("tailwindcss");
const TW = join(
	process.cwd(),
	"node_modules/.pnpm/tailwindcss@4.3.3/node_modules/tailwindcss",
);
const sheet = readFileSync(join(TW, "index.css"), "utf8");
const compiler = await compile('@import "tailwindcss";', {
	base: process.cwd(),
	loadStylesheet: async () => ({ path: "tw.css", base: TW, content: sheet }),
	loadModule: async () => ({}),
});
const spacingRem = Number(
	compiler.build(["px-1"]).match(/--spacing:\s*([\d.]+)rem/)?.[1],
);
const toPx = (value) => {
	const calc = value.match(/calc\(var\(--spacing\)\s*\*\s*(-?[\d.]+)\)/);
	if (calc) return Number(calc[1]) * spacingRem * 16;
	const px = value.match(/^(-?[\d.]+)px$/);
	if (px) return Number(px[1]);
	throw new Error(`unparsed length ${value}`);
};
/** The computed length of one property a class sets, e.g. `pe-[4.5px]`. */
const lengthOf = (candidate, property) => {
	const css = compiler.build([candidate]);
	// CSS escapes `[`, `]` and `.` in a selector; the RegExp escapes them again.
	const selector = candidate.replace(/[[\].]/g, (c) => `\\\\\\${c}`);
	const rule = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1];
	assert.ok(rule, `tailwind emitted no rule for ${candidate}`);
	const value = rule.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1];
	assert.ok(value, `${candidate} sets no ${property}`);
	return toPx(value.trim());
};

/** The className expression right after an anchor in a source file. */
const classAfter = (source, anchor) => {
	const at = source.indexOf(anchor);
	assert.notEqual(at, -1, `anchor not found: ${anchor}`);
	const m = source
		.slice(at)
		.match(/className=(\{cn\(([\s\S]*?)\)\}|"([^"]*)")/);
	assert.ok(m, `no className after ${anchor}`);
	return m[2] ?? m[3];
};

const BANDS = [
	["Back row", column, "data-team-bridge-back-row"],
	["organization header", page, "<header\n"],
	["quick rows nav", page, 't("ui.teamBridge.drafts.navigation")'],
	["rail section", rail, "<section aria-labelledby={id}"],
	["owner-audit section", audit, "rail: (beforeSelect) =>"],
	["account foot", foot, "export const SidebarFoot"],
];

test("SIDEBAR_INSET is one symmetric spacing class, and it computes to 8px", () => {
	assert.equal(INSET_CLASS, "px-2");
	assert.equal(lengthOf(INSET_CLASS, "padding-inline"), 8);
});

for (const [name, source, anchor] of BANDS) {
	test(`${name} takes the shared inset and no inset of its own`, () => {
		const cls = classAfter(source, anchor);
		assert.match(cls, /SIDEBAR_INSET/, `${name}: ${cls}`);
		assert.doesNotMatch(
			cls,
			/(?:^|[\s"])-?(?:px|ps|pe|pl|pr|mx|ms|me)-/,
			`${name} carries a second inline inset: ${cls}`,
		);
	});
}

test("every leading mark starts on the 16px line", () => {
	const band = lengthOf(INSET_CLASS, "padding-inline");
	// Rows, quick rows, Back, the org switcher: each control pads itself `px-2`.
	const rowClass = rail.match(/export const RAIL_ROW =\s*"([^"]+)"/)?.[1];
	assert.match(rowClass, /\bpx-2\b/);
	assert.equal(band + lengthOf("px-2", "padding-inline"), LINE);
	// The section header and a group header pad their start `ps-2`.
	assert.match(classAfter(rail, 'className="group/section'), /\bps-2\b/);
	assert.match(
		rail.match(/"truncate py-1 [^"]*text-ink-muted"/)?.[0] ?? "",
		/\bps-2\b/,
	);
	assert.equal(band + lengthOf("ps-2", "padding-inline-start"), LINE);
	// The owner-audit header, note and failure line: `px-2` inside the band.
	for (const anchor of ["export function OwnerAuditSectionHeader"]) {
		assert.match(classAfter(audit, anchor), /\bpx-2\b/);
	}
	assert.match(
		audit,
		/<AuditFailure state=\{state\} retry=\{retry\} inset="px-2" \/>/,
	);
});

test("every trailing mark ends on the 16px line from the end edge", () => {
	const band = lengthOf(INSET_CLASS, "padding-inline");
	// A row's badge or mute bell is its last flex child: band + the row's `px-2`.
	assert.equal(band + lengthOf("px-2", "padding-inline"), LINE);

	// The section header's "..." and "+": a 20px box centring a 13px glyph.
	const header = rail.match(/className="group\/section ([^"]+)"/)?.[1] ?? "";
	const pe = header.match(/\bpe-(\[[^\]]+\]|\d+(?:\.\d+)?)/)?.[0];
	assert.ok(pe, `section header has no end padding: ${header}`);
	assert.match(rail, /flex size-5 items-center justify-center/);
	assert.match(rail, /<Plus size=\{13\}/);
	assert.match(rail, /<MoreHorizontal size=\{13\}/);
	assert.equal(band + lengthOf(pe, "padding-inline-end") + (20 - 13) / 2, LINE);

	// Both hover "..." menus: absolutely placed 24px boxes centring a 14px glyph.
	const ends = [...rail.matchAll(/className="absolute (end-[^\s"]+)/g)].map(
		(m) => m[1],
	);
	assert.equal(ends.length, 2, `expected two row menus, saw ${ends}`);
	for (const end of ends)
		assert.equal(
			band + lengthOf(end, "inset-inline-end") + (24 - 14) / 2,
			LINE,
		);

	// The organization "+" (Button size="icon", 32px, 16px glyph) is the
	// header's LAST child: the refresh dot moved before it.
	const headerSrc = page.slice(
		page.indexOf('<h1 className="sr-only">'),
		page.indexOf("</header>"),
	);
	assert.ok(
		headerSrc.indexOf("data-rail-refreshing") <
			headerSrc.indexOf("<Plus size={16} />"),
		"the refresh dot must sit before the organization +",
	);
	assert.equal(band + (32 - 16) / 2, LINE);
});

test("the rail scrollbar stays an overlay, so it takes no inset", () => {
	const area = read("src/renderer/src/shared/components/ui/scroll-area.tsx");
	assert.match(area, /ScrollAreaPrimitive\.ScrollAreaScrollbar/);
	assert.doesNotMatch(
		page.match(
			/<ScrollArea className="([^"]+)">\s*\{\/\*\s*\* THE SENTENCE/,
		)?.[1] ?? "",
		/\bp[xe]-/,
	);
});
