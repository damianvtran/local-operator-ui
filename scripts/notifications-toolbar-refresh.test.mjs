import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * REFRESH RIDES THE TOOLBAR; THERE IS NO HEADER ROW (operator, 2026-11-23).
 *
 * WHY THIS FILE EXISTS. Removing the routes' visible page titles left the
 * Notifications page with a `PageHeader` row whose only content was the refresh
 * icon (and, while scrolled, the "N new" chip): a lone icon on its own line above
 * the filters. The fix moves both into the toolbar's `trailing` slot and leaves
 * the compact header self-closing (its sr-only h1 only). This pin keeps a later
 * edit from re-growing that row - e.g. by passing children to the compact header
 * again - which no type check would catch, because `PageHeader` accepts children.
 *
 * It is a SOURCE pin by design: jsdom has no layout, so "on its own row" is not
 * observable there. The mounted proof that the controls render INSIDE
 * `[data-notifications-toolbar]` lives in notifications-page-pill.test.mjs.
 * Each predicate is also run against the pre-fix shape below (the negative
 * control), so a predicate that silently matches everything cannot pass.
 */

const SOURCE = readFileSync(
	new URL(
		"../src/renderer/src/features/notifications/components/notifications-page.tsx",
		import.meta.url,
	),
	"utf8",
);

/* The loaded page (after the `!enabled` gate), from its root to the toolbar call. */
const pageRegion = (src) => {
	const start = src.indexOf('data-notifications-page=""');
	assert.ok(start >= 0, "the loaded page root is marked");
	const toolbar = src.indexOf("<Toolbar", start);
	assert.ok(toolbar > start, "the page renders <Toolbar");
	const end = src.indexOf("loaded={loaded}", toolbar);
	assert.ok(end > toolbar, "the toolbar call passes loaded");
	return {
		beforeToolbar: src.slice(start, toolbar),
		call: src.slice(toolbar, end),
	};
};

const COMPACT_SELF_CLOSING =
	/<PageHeader\s+variant="compact"\s+title=\{t\("ui\.notifications\.page\.title"\)\}\s*\/>/;
const REFRESH_LABEL = 'aria-label={t("ui.notifications.page.refresh")}';

/* Hoisted: Biome's useTopLevelRegex. */
const GHOST_ICON_SM = /variant="ghost"\s+size="icon-sm"/;
const TRAILING_CLASS = /className="ms-auto flex shrink-0 items-center gap-2"/;
const PHYSICAL_AUTO = /\bml-auto\b|\bmr-auto\b/;
const TRAILING_USE = /\{trailingGroup\}/g;

/** True when nothing but the sr-only h1 precedes the toolbar. */
const noHeaderRow = (src) => {
	const { beforeToolbar } = pageRegion(src);
	return (
		COMPACT_SELF_CLOSING.test(beforeToolbar) &&
		!beforeToolbar.includes("</PageHeader>") &&
		!beforeToolbar.includes(REFRESH_LABEL) &&
		!beforeToolbar.includes("data-notifications-back-to-top")
	);
};

/** True when refresh and the back-to-top chip are passed as the toolbar's `trailing`. */
const refreshInToolbar = (src) => {
	const { call } = pageRegion(src);
	const trailing = call.indexOf("trailing={");
	return (
		trailing >= 0 &&
		call.indexOf(REFRESH_LABEL, trailing) > trailing &&
		call.indexOf("data-notifications-back-to-top", trailing) > trailing
	);
};

/*
 * The pre-fix shape, reduced to what the predicates read: the compact header
 * WITH children (the lone row), and a toolbar call with no `trailing`.
 */
const PRE_FIX = `
		<div data-notifications-page="">
			<div className="flex shrink-0 flex-col gap-4 px-6 pt-6">
				<PageHeader variant="compact" title={t("ui.notifications.page.title")}>
					<div className="flex flex-wrap items-center gap-2">
						{list.newerCount > 0 && (
							<Button data-notifications-back-to-top="">new</Button>
						)}
						<Button
							variant="ghost"
							size="icon"
							aria-label={t("ui.notifications.page.refresh")}
						>
							<RefreshCw />
						</Button>
					</div>
				</PageHeader>
				<Toolbar
					loaded={loaded}
				/>
`;

test("negative control: the pre-fix lone header row fails both predicates", () => {
	assert.equal(noHeaderRow(PRE_FIX), false, "pre-fix has a header row");
	assert.equal(refreshInToolbar(PRE_FIX), false, "pre-fix refresh is outside");
});

test("the compact header is self-closing: no row precedes the toolbar", () => {
	assert.ok(noHeaderRow(SOURCE));
});

test("refresh and the back-to-top chip are the toolbar's trailing controls", () => {
	assert.ok(refreshInToolbar(SOURCE));
	const { call } = pageRegion(SOURCE);
	const refresh = call.slice(
		call.indexOf(REFRESH_LABEL) - 400,
		call.indexOf(REFRESH_LABEL),
	);
	/* Same 28px height as the `size="sm"` chips, and quieter than them. */
	assert.match(refresh, GHOST_ICON_SM);
	for (const kept of [
		'title={t("ui.notifications.page.refresh")}',
		"aria-busy={list.isFetching || undefined}",
		"disabled={list.isFetching}",
		"void list.refresh();",
	]) {
		assert.ok(call.includes(kept), `refresh keeps ${kept}`);
	}
});

test("the toolbar renders the trailing group in BOTH modes, at the logical end", () => {
	const body = SOURCE.slice(SOURCE.indexOf("const Toolbar: FC<ToolbarProps>"));
	const group = body.slice(
		body.indexOf("const trailingGroup"),
		body.indexOf("return ("),
	);
	/* `ms-auto`, never `ml-auto`: the end edge in RTL is the left one. */
	assert.match(group, TRAILING_CLASS);
	assert.doesNotMatch(group, PHYSICAL_AUTO);
	const uses = body.slice(0, body.indexOf("\n};\n")).match(TRAILING_USE) ?? [];
	assert.equal(
		uses.length,
		2,
		"selection bar and filter bar both close with it",
	);
});
