#!/usr/bin/env node
/**
 * Focused RTL contracts for the surfaces left physical by the shell slice.
 * Behavioural helpers are executed; DOM geometry remains rendered-app evidence.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `export {
			physicalMoveTarget,
			physicalScrollEdges,
			pointerIsAfterTab,
		} from "./src/renderer/src/features/browser/components/browser-tab-direction";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
});
const module_ = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
	module: module_,
	exports: module_.exports,
});
const { physicalMoveTarget, physicalScrollEdges, pointerIsAfterTab } =
	module_.exports;

const source = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("browser move actions follow physical edges in both directions", () => {
	const cases = [
		// [index, direction, left target, right target]
		[0, "ltr", null, 1],
		[1, "ltr", 0, 2],
		[2, "ltr", 1, null],
		[0, "rtl", 1, null],
		[1, "rtl", 2, 0],
		[2, "rtl", null, 1],
	];
	for (const [index, direction, left, right] of cases) {
		assert.equal(
			physicalMoveTarget(index, 3, "left", direction),
			left,
			`${direction} index=${index} move left`,
		);
		assert.equal(
			physicalMoveTarget(index, 3, "right", direction),
			right,
			`${direction} index=${index} move right`,
		);
	}
});

test("browser overflow uses Chromium's negative RTL scrollLeft at both edges", () => {
	const cases = [
		[0, "ltr", false, true],
		[300, "ltr", true, false],
		[0, "rtl", true, false],
		[-300, "rtl", false, true],
		[-150, "rtl", true, true],
	];
	for (const [scrollLeft, direction, left, right] of cases) {
		const actual = physicalScrollEdges(scrollLeft, 200, 500, direction);
		assert.equal(actual.left, left, `${direction} scrollLeft=${scrollLeft}`);
		assert.equal(actual.right, right, `${direction} scrollLeft=${scrollLeft}`);
	}
});

test("browser drop-after follows DOM order rather than physical right", () => {
	assert.equal(pointerIsAfterTab(175, 150, "ltr"), true);
	assert.equal(pointerIsAfterTab(125, 150, "ltr"), false);
	assert.equal(pointerIsAfterTab(125, 150, "rtl"), true);
	assert.equal(pointerIsAfterTab(175, 150, "rtl"), false);
});

test("deferred overlays and sheets use logical inline edges", () => {
	const dialog = source("src/renderer/src/shared/components/ui/dialog.tsx");
	assert.match(dialog, /absolute top-4 end-4/);
	assert.match(dialog, /gap-1\.5 pe-8/);

	const sheet = source("src/renderer/src/shared/components/ui/sheet.tsx");
	assert.match(sheet, /start:\s*"inset-y-0 start-0 .*border-e"/);
	assert.match(sheet, /end:\s*"inset-y-0 end-0 .*border-s"/);
	assert.match(sheet, /absolute top-4 end-4/);

	const options = source(
		"src/renderer/src/features/chat/components/chat-options-sidebar.tsx",
	);
	assert.match(options, /<SheetContent\s+side="end"/);
	const library = source(
		"src/renderer/src/features/library/components/library-page.tsx",
	);
	assert.match(library, /<SheetContent\s+side="start"/);
});

test("update cards, floating alerts and filter rows mirror", () => {
	const update = source(
		"src/renderer/src/shared/components/common/update-notification.tsx",
	);
	assert.match(update, /fixed top-4 end-4/);
	assert.match(update, /absolute top-2 end-2/);
	const alert = source(
		"src/renderer/src/shared/components/common/floating-alert.tsx",
	);
	assert.match(alert, /fixed end-4 bottom-4/);
	assert.match(alert, /relative pe-10/);
	const filters = source(
		"src/renderer/src/features/library/components/library-filter-rail.tsx",
	);
	assert.match(filters, /text-start text-body-sm/);
	assert.match(filters, /indent && "ps-6"/);
});

test("shell tooltips and directional icons follow the inline axis", () => {
	const sidebar = source(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(sidebar, /side=\{rtl \? "left" : "right"\}/);
	const rail = source(
		"src/renderer/src/shared/components/navigation/panel-rail-item.tsx",
	);
	assert.match(rail, /side=\{direction === "rtl" \? "right" : "left"\}/);
	const menu = source(
		"src/renderer/src/shared/components/ui/dropdown-menu.tsx",
	);
	assert.match(menu, /ChevronRight\s+className="ms-auto .*rtl:-scale-x-100"/);
	const media = source(
		"src/renderer/src/features/library/components/pptx-viewer.tsx",
	);
	assert.doesNotMatch(media, /rtl:-scale-x-100/);
});

test("wide transcript, table and composer utilities stay logical", () => {
	const transcript = source(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	);
	assert.match(
		transcript,
		/commentaryOverlay && "pe-10 @min-\[900px\]\/chatcol:pe-0"/,
	);
	assert.match(
		transcript,
		/overlayClassName="@min-\[900px\]\/chatcol:-end-10"/,
	);
	assert.doesNotMatch(transcript, /@min-\[900px\]\/chatcol:(?:pr-0|-right-10)/);

	const wysiwyg = source(
		"src/renderer/src/features/chat/components/canvas/wysiwyg-markdown-editor.tsx",
	);
	assert.match(wysiwyg, /\[&_:is\(th,td\)\]:pe-4/);
	assert.match(wysiwyg, /\[&_:is\(th,td\):last-child\]:pe-0/);
	const composer = source(
		"src/renderer/src/features/chat/components/composer-status-row.tsx",
	);
	assert.match(composer, /const FIRST_CHIP = "-ms-1\.5";/);
});

test("technical islands are explicitly LTR without a document-wide override", () => {
	const startPage = source(
		"src/renderer/src/features/browser/components/browser-new-tab.tsx",
	);
	// Current main has no new-tab address field. Do not reintroduce one during
	// RTL integration; the remaining URL editor owns the explicit LTR boundary.
	assert.doesNotMatch(startPage, /browser-start-page-address/);
	const addressBar = source(
		"src/renderer/src/features/browser/components/browser-url-bar.tsx",
	);
	assert.match(addressBar, /dir="ltr"/);
	const codeTheme = source(
		"src/renderer/src/shared/themes/code-mirror-theme.ts",
	);
	assert.match(codeTheme, /"\.cm-content": \{[\s\S]*?direction: "ltr"/);
	const markdown = source(
		"src/renderer/src/features/chat/components/markdown-renderer.tsx",
	);
	assert.match(markdown, /<code dir="ltr" className=\{className\}/);
});

test("technical and directional surfaces keep their physical semantics", () => {
	const address = source(
		"src/renderer/src/features/browser/components/browser-url-bar.tsx",
	);
	assert.match(address, /dir="ltr"/);
	assert.match(address, /pr-7 pl-8/);
	const timeline = source(
		"src/renderer/src/features/projects/components/project-timeline.tsx",
	);
	assert.match(timeline, /sticky left-0/);
	const mesh = source("src/renderer/src/features/mesh/mesh-canvas.tsx");
	assert.match(mesh, /absolute top-0 left-0/);
});

test("one direction provider gives every portalled menu the locale direction", () => {
	const provider = source("src/renderer/src/shared/i18n/locale-direction.tsx");
	assert.match(provider, /useTextDirection\(\)/);
	assert.match(provider, /<Direction\.Provider dir=\{direction\}>/);
	const entry = source("src/renderer/src/main.tsx");
	assert.match(
		entry,
		/<LocaleDirectionProvider>\s*<App \/>\s*<\/LocaleDirectionProvider>/,
		"the provider wraps the app, so menus opened on any route inherit it",
	);
	// The logical insets the review names were converted on the primitive; they
	// are only inline-start/end when a direction reaches the portalled content.
	const menus = source(
		"src/renderer/src/shared/components/ui/dropdown-menu.tsx",
	);
	assert.match(menus, /inset && "ps-8"/);
	assert.match(menus, /className="ms-auto text-ink-dim rtl:-scale-x-100"/);
	assert.match(menus, /<span className="absolute start-2 flex size-4/);
	/*
	 * THE TAB MENU LEFT THIS LIST (LOH-13 operator report, 2026-10-25). It is a
	 * native Electron menu now: the OS positions it and draws it above the page,
	 * so there is no portalled panel and no physical `collisionPadding` for the
	 * direction to correct. The pin is the absence - and the trigger's explicit
	 * `aria-haspopup`, which no Radix trigger adds any more.
	 */
	const tabs = source(
		"src/renderer/src/features/browser/components/browser-tab-strip.tsx",
	);
	assert.ok(
		!tabs.includes('data-tour-tag="browser-tab-actions"'),
		"a native menu has no renderer panel to position or pad",
	);
	assert.match(tabs, /aria-haspopup="menu"/);
});

test("technical runs are isolated inside RTL prose", () => {
	assert.match(
		source("src/renderer/src/features/chat/components/trace/tool-row.tsx"),
		/<bdi dir="ltr">\{summaryText\}<\/bdi>/,
		"a tool summary keeps its own order: a leading slash must not move",
	);
	assert.match(
		source(
			"src/renderer/src/features/chat/components/message-item/turn-timestamp.tsx",
		),
		/<bdi>\{formatTurnTimestamp\(date, now\)\}<\/bdi>/,
	);
	const summary = source(
		"src/renderer/src/features/chat/components/trace/turn-summary.tsx",
	);
	assert.equal(
		summary.match(/<bdi>\{actionClause\}<\/bdi>/g)?.length,
		2,
		"both action-count render sites isolate the count",
	);
	const freshness = source(
		"src/renderer/src/features/chat/components/canvas/document-freshness-bar.tsx",
	);
	/*
	 * The two runs are adjacent; the formatter is free to spell the between them
	 * either as a literal space or as `{" "}`, so the pin accepts both.
	 */
	assert.match(
		freshness,
		/<bdi>\{t\("ui\.canvas\.files\.modified"\)\}<\/bdi>(?:\{" "\}|\s)+<bdi>\{dateText\}<\/bdi>/,
		"the word is the shipped key, not a JSX literal; the date stays its own run",
	);
	/*
	 * D4c: the clock is a run of its own. `formatCalendarDateTime` is one Intl
	 * string, and inside the date's RTL `<bdi>` its trailing `AM 7:53` swapped
	 * because the space before it is neutral. The split only runs when the
	 * formatted clock really is the string's tail, so a locale that moves the
	 * clock keeps the single-run rendering.
	 */
	assert.match(
		freshness,
		/<bdi dir="ltr">\{clock\}<\/bdi>/,
		"the clock is rendered as its own LTR run",
	);
	assert.match(
		freshness,
		/clockIsTail\s*=\s*modifiedText !== null &&\s*clock !== null &&\s*clock\.length > 0 &&\s*modifiedText\.endsWith\(clock\)/,
		"the split is guarded by the clock actually being the tail",
	);
});

test("direction-dependent glyphs and truncation follow the locale", () => {
	assert.match(
		source("src/renderer/src/shared/components/ui/disclosure.tsx"),
		/<ChevronRight className="size-3\.5 rtl:-scale-x-100" aria-hidden=\{true\} \/>/,
		"the collapsed chevron mirrors; the open ChevronDown is direction-neutral",
	);
	const tabs = source(
		"src/renderer/src/features/browser/components/browser-tab-strip.tsx",
	);
	const auto = tabs.match(/<span[^>]*\bdir="auto"[^>]*>/g) ?? [];
	assert.equal(auto.length, 2, "both tab-title spans take their own direction");
	/*
	 * D6: `dir="auto"` gives the span its own base direction, so `text-start`
	 * would resolve to the LATIN start (left) inside an RTL tab; the cell keeps
	 * dir=auto for truncation and aligns to the locale's inline start instead.
	 */
	const aligned = tabs.match(/<span[^>]*rtl:text-right[^>]*>/g) ?? [];
	assert.equal(
		aligned.length,
		2,
		"both title cells align to the tab's start in Urdu",
	);
});

test("the tab menu isolates a quoted title inside its sentence", () => {
	const tabs = source(
		"src/renderer/src/features/browser/components/browser-tab-strip.tsx",
	);
	assert.ok(
		tabs.includes("const isolatedTabLabel = (title: string): string =>"),
		"the helper exists beside tabLabel",
	);
	assert.ok(
		tabs.includes("`\\u2068${tabLabel(title)}\\u2069`"),
		"the value is wrapped in FSI/PDI, the inline equivalent of <bdi>",
	);
	assert.match(
		tabs,
		/label: isolatedTabLabel\(tab\.title\),/,
		"the request's title is isolated once, at the strip's boundary",
	);
	const model = source(
		"src/renderer/src/features/browser/model/tab-actions-menu-model.ts",
	);
	assert.equal(
		model.match(/title: label\s*[,}]/g)?.length,
		5,
		"every title-bearing item in the menu rule uses the isolated label",
	);
	assert.ok(
		!model.includes("tab.title"),
		"the model never reaches past the isolated label for a title",
	);
});

test("the freshness split's clock really is the tail in both gated locales", () => {
	/*
	 * The split is guarded by `modifiedText.endsWith(clock)`, so the guard is
	 * only worth its comment if that assumption holds where the app ships. This
	 * executes Intl directly with the SAME option bags the two call sites use
	 * (`formatCalendarDateTime`'s numeric/long/numeric + hour/minute, and the
	 * clock's hour/minute) — it pins the assumption, not the pixels; the frames
	 * are QA's.
	 */
	const instant = new Date("2026-10-24T07:53:00");
	const dateOptions = {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	};
	const clockOptions = { hour: "numeric", minute: "2-digit" };
	const cases = [
		["en", "October 24, 2026 at 7:53 AM"],
		["ur", "24 اکتوبر، 2026 کو 7:53 AM"],
	];
	for (const [locale, expected] of cases) {
		const full = new Intl.DateTimeFormat(locale, dateOptions).format(instant);
		const clock = new Intl.DateTimeFormat(locale, clockOptions).format(instant);
		assert.equal(
			full,
			expected,
			`${locale} still composes the stamp the same way`,
		);
		assert.ok(
			full.endsWith(clock),
			`${locale}: the clock is the tail, which is what the split guard reads`,
		);
	}
});
