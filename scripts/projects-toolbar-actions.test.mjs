import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * REFRESH AND NEW PROJECT RIDE THE SEARCH ROW; THERE IS NO HEADER ROW
 * (operator, 2026-11-23 - the Notifications fix, c0e11b364a0, applied to the
 * Projects page an audit found with the same leftover).
 *
 * WHY THIS FILE EXISTS. Removing the routes' visible page titles left Projects
 * with a `PageHeader` row whose only content was the refresh icon and "New
 * project", above the view-switcher/search row. The fix passes both into the
 * search cluster's `trailing` and leaves the compact header self-closing (its
 * sr-only h1 only). `PageHeader` accepts children, so no type check stops a
 * later edit from re-growing that row; this pin does.
 *
 * WHY INSIDE THE CLUSTER. The cluster is one non-wrapping flex group whose
 * field is `min-w-0`: there the field shrinks and the actions stay beside it.
 * As a sibling `flex-wrap` item of the row they would wrap to their own line
 * first. The U7 count boundaries move with the added width, so they are pinned
 * here too.
 *
 * It is a SOURCE pin by design: jsdom has no layout. Each predicate is also run
 * against the pre-fix shape (the negative control), so a predicate that
 * silently matches everything cannot pass.
 */

const read = (rel) =>
	readFileSync(
		new URL(
			`../src/renderer/src/features/projects/components/${rel}`,
			import.meta.url,
		),
		"utf8",
	);
const SOURCE = read("projects-page.tsx");
const TOOLBAR = read("projects-toolbar.tsx");

/* The loaded page's header block: from its `@container` root to the chips row. */
const pageRegion = (src) => {
	const start = src.indexOf(
		'className="@container flex shrink-0 flex-col gap-8 px-6 pt-6"',
	);
	assert.ok(start >= 0, "the loaded page's header block is present");
	const row = src.indexOf('data-project-search-row=""', start);
	assert.ok(row > start, "the search row is marked");
	const call = src.indexOf("<ProjectsSearchControls", row);
	assert.ok(call > row, "the row renders <ProjectsSearchControls");
	const end = src.indexOf("<ProjectsFilterChips", call);
	assert.ok(end > call, "the chips row follows the cluster");
	return { beforeRow: src.slice(start, row), call: src.slice(call, end) };
};

const COMPACT_SELF_CLOSING =
	/<PageHeader\s+variant="compact"\s+title=\{t\("ui\.projects\.projects_page\.projects"\)\}\s*\/>/;
const REFRESH_LABEL = '"ui.projects.projects_page.refresh_projects"';
const CREATE_TAG = 'data-tour-tag="create-project-button"';

/* Hoisted: Biome's useTopLevelRegex. */
const ACTIONS_CLASS = /className="ms-auto flex shrink-0 items-center gap-2"/;
const CLASS_VALUE = /className="([^"]*)"/g;
const PHYSICAL_AUTO = /\bml-auto\b|\bmr-auto\b/;
const GHOST_ICON_SM = /variant="ghost"\s+size="icon-sm"/;
const GHOST_SM = /variant="ghost"\s+size="sm"/;
const BOARD_REVEAL = /view === "board" \? "@\[57rem\]:inline" : undefined/;
const CLUSTER_CLASS =
	/<div className="ms-auto flex min-w-0 items-center gap-3">/;
const FIELD_CLASS = /<div className="relative w-full min-w-0 max-w-\[400px\]">/;
const DEFAULT_REVEAL = /countRevealClass = "@\[47rem\]:inline"/;

/** True when nothing but the sr-only h1 precedes the search row. */
const noHeaderRow = (src) => {
	const { beforeRow } = pageRegion(src);
	return (
		COMPACT_SELF_CLOSING.test(beforeRow) &&
		!beforeRow.includes("</PageHeader>") &&
		!beforeRow.includes(REFRESH_LABEL) &&
		!beforeRow.includes(CREATE_TAG)
	);
};

/** True when refresh and New project are passed as the cluster's `trailing`. */
const actionsInCluster = (src) => {
	const { call } = pageRegion(src);
	const trailing = call.indexOf("trailing={");
	return (
		trailing >= 0 &&
		call.indexOf(REFRESH_LABEL, trailing) > trailing &&
		call.indexOf(CREATE_TAG, trailing) > trailing
	);
};

/* The pre-fix shape, reduced to what the predicates read. */
const PRE_FIX = `
			<div className="@container flex shrink-0 flex-col gap-8 px-6 pt-6">
				<PageHeader
					variant="compact"
					title={t("ui.projects.projects_page.projects")}
				>
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							size="icon"
							aria-label={t("ui.projects.projects_page.refresh_projects")}
						>
							<RefreshCw />
						</Button>
						<Button variant="secondary" data-tour-tag="create-project-button">
							New project
						</Button>
					</div>
				</PageHeader>
				<div className="flex shrink-0 flex-col gap-2">
					<div data-project-search-row="">
						<ProjectsSearchControls
							trailing={view === "board" ? <BoardWindowSelect /> : null}
						/>
					</div>
					<ProjectsFilterChips />
`;

test("negative control: the pre-fix lone header row fails both predicates", () => {
	assert.equal(noHeaderRow(PRE_FIX), false, "pre-fix has a header row");
	assert.equal(actionsInCluster(PRE_FIX), false, "pre-fix actions are outside");
});

test("the compact header is self-closing: no row precedes the search row", () => {
	assert.ok(noHeaderRow(SOURCE));
});

test("refresh and New project close the search cluster, ghost at the row's height", () => {
	assert.ok(actionsInCluster(SOURCE));
	const { call } = pageRegion(SOURCE);
	const group = call.slice(call.indexOf("data-projects-actions"));
	/* `ms-auto`, never `ml-auto`: the end edge in RTL is the left one. */
	assert.match(call, ACTIONS_CLASS);
	/* Class strings only: the comment beside them names `ml-auto` to forbid it. */
	for (const [, cls] of call.matchAll(CLASS_VALUE)) {
		assert.doesNotMatch(cls, PHYSICAL_AUTO);
	}
	/* 28px, the Filters button's `size="sm"` height. */
	assert.match(group, GHOST_ICON_SM);
	assert.match(group, GHOST_SM);
	for (const kept of [
		"disabled={list.isFetching}",
		"void list.refetch()",
		'data-tour-tag="refresh-projects-button"',
		"setCreateOpen(true)",
		'"ui.projects.projects_page.new_project"',
	]) {
		assert.ok(group.includes(kept), `actions keep ${kept}`);
	}
	/* The Board's window control still rides the same slot, gated as before. */
	assert.ok(
		call.indexOf("<BoardWindowSelect") < call.indexOf("data-projects-actions"),
	);
});

test("U7's count reveal accounts for the actions' width on both rows", () => {
	assert.match(SOURCE, BOARD_REVEAL);
	assert.match(TOOLBAR, DEFAULT_REVEAL);
	/* The cluster the actions join stays a single non-wrapping, shrinkable group. */
	const cluster = TOOLBAR.slice(
		TOOLBAR.indexOf("export const ProjectsSearchControls"),
	);
	assert.match(cluster, CLUSTER_CLASS);
	assert.match(cluster, FIELD_CLASS);
});
