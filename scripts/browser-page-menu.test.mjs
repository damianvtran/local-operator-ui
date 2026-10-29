import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * S5: the page menu is what has NO row control.
 *
 * Back, Forward, Reload/Stop, Home, Address and Approvals are permanent controls
 * in the address row now, so repeating them in this menu would be two affordances
 * for one action. What remains: Find, Print, Reset zoom (only off 100%), the
 * downloads folder (only when known), Approvals, and — only when a narrow pane
 * has FOLDED them — Forward and Home.
 *
 * WHY SOURCE + MARKUP GUARDS AND NOT A DRIVEN MENU. jsdom cannot measure the
 * panel, so it cannot decide the pause (that is the native probe's row: an
 * inside-band menu must not pause, a crossing one must). What is decidable here
 * is the item set, the fold rule and the icon-only trigger.
 */

const menu = readFileSync(
	"src/renderer/src/features/browser/components/browser-page-menu.tsx",
	"utf8",
);

test("the menu offers only what the row cannot", () => {
	for (const key of [
		"find_in_page",
		"print_page",
		"page_zoom_reset",
		"open_downloads_folder",
		"approvals",
	]) {
		assert.match(
			menu,
			new RegExp(
				`browser_url_bar\\.${key}|browser_file_transfer_row\\.${key}|chrome\\.${key}`,
			),
			key,
		);
	}
});

test("the duplicated navigation items are gone", () => {
	// The row owns them. `browser-back`, `browser-forward`, `browser-reload`,
	// `browser-stop`, `browser-home` and `browser-address` are ROW tags; only the
	// folded Forward/Home rows may reappear, with their own menu tags.
	assert.doesNotMatch(menu, /browser_url_bar\.back/);
	assert.doesNotMatch(menu, /browser_url_bar\.reload/);
	assert.doesNotMatch(menu, /browser_url_bar\.stop_loading/);
	assert.doesNotMatch(menu, /browser_url_bar\.address/);
	assert.doesNotMatch(menu, /data-tour-tag="browser-back"/);
	assert.doesNotMatch(menu, /data-tour-tag="browser-address"/);
});

test("folded controls appear only when the row folded them", () => {
	assert.match(menu, /showForward: boolean/);
	assert.match(menu, /showHome: boolean/);
	assert.match(menu, /\{folded && \(/);
	assert.match(menu, /\{showForward && \(/);
	assert.match(menu, /\{showHome && \(/);
	assert.match(menu, /browser-page-menu-forward/);
	assert.match(menu, /browser-page-menu-home/);
	// Reset zoom and the downloads folder are conditional facts, not always-on rows.
	assert.match(menu, /\{pageZoom !== 1 && \(/);
	assert.match(menu, /\{downloadsDir && \(/);
});

test("the trigger is the fixed icon-only overflow control", () => {
	assert.match(menu, /size="icon-sm"/);
	assert.match(menu, /triggerRef\?: Ref<HTMLButtonElement>/);
	assert.match(menu, /ref=\{triggerRef\}/);
	assert.match(
		menu,
		/suppressed=\{open \|\| returning\}/,
		"the trigger's own tooltip must not capture Escape or linger after close",
	);
	assert.match(menu, /disableHoverableContent/);
	assert.match(
		menu,
		/discardWhileSuppressed=\{open \|\| returning\}/,
		"the page-menu panel opts into discard; the shared default resumes (U14)",
	);
	assert.match(menu, /data-tour-tag="browser-page-menu"/);
	assert.match(menu, /aria-label=\{pageMenuLabel\}/);
	assert.match(menu, /showApprovalsFolded && waitingCount > 0/);
	assert.match(
		menu,
		/ui\.browser\.browser_url_bar\.approvals_waiting/,
		"the folded trigger's name carries the waiting count (U15)",
	);
});

test("the folded Approvals count rides the trigger (U12) and is not re-announced (D6a)", () => {
	assert.match(menu, /showApprovalsFolded && waitingCount > 0/);
	assert.match(menu, /countLabel\(waitingCount, 99\)/);
	assert.match(menu, /aria-hidden="true"/);
});

test("page controls are disabled where main will refuse them (Q4-3)", () => {
	assert.match(menu, /canControlPage: boolean/);
	assert.equal(
		(menu.match(/disabled=\{!canControlPage\}/g) ?? []).length,
		3,
		"Find, Print and Reset zoom are the page-control items",
	);
});

test("Find travels the one openFind path while the panel pauses the page", () => {
	const surface = readFileSync(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"utf8",
	);
	assert.match(menu, /onSelect=\{onFind\}/);
	assert.match(surface, /onFind=\{\(\) => void openFind\("chrome"\)\}/);
});

test("the panel is the shared menu primitive, whose pause is measured", () => {
	assert.match(menu, /<DropdownMenuContent/);
	assert.doesNotMatch(menu, /useSuppressBrowserView\(/);
	const primitive = readFileSync(
		"src/renderer/src/shared/components/ui/dropdown-menu.tsx",
		"utf8",
	);
	assert.match(
		primitive,
		/useMeasuredBrowserViewPanel<HTMLDivElement>\("menu"\)/,
	);
});

test("closing a narrow Approvals dock returns focus to the ⋯ that opened it", () => {
	const surface = readFileSync(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"utf8",
	);
	assert.match(
		surface,
		/\(approvalsTriggerRef\.current \?\? pageMenuTriggerRef\.current\)\?\.focus\(\)/,
		"the wide path keeps the shield; the folded path must not drop focus to body",
	);
	assert.match(surface, /triggerRef=\{pageMenuTriggerRef\}/);
});
