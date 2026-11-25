/**
 * Every centred modal renders through the ONE shared dialog primitive.
 *
 * THE OPERATOR'S REQUEST IS WHAT THIS PINS (2026-11-24): the restyled setup card
 * (subtle gradient, soft outline, darker backdrop) should be "a generic format
 * for all the dialogs that pop up", through "a shared dialog component that this
 * can be applied to in order to make it consistent". That only holds while every
 * modal in the renderer is drawn by `shared/components/ui/dialog.tsx`
 * (`DialogContent` / `DialogOverlay`, directly or through `BaseDialog`): a modal
 * that paints its own scrim and panel silently keeps the old look the next time
 * the primitive is restyled, and nobody notices until the operator does.
 *
 * THE CENSUS THIS FILE FREEZES (refactor/shared-dialog-migration): 70 modal call
 * sites in 60 files, all already on the primitive - 28 `<BaseDialog>` and 42
 * `<DialogContent>` (one of those is `BaseDialog`'s own). The surfaces that LOOK like hand-rolled modals are
 * not modals and stay as they are: the phone-pairing card and the session
 * switcher are `aria-modal="false"` on purpose (neither may trap focus; the
 * switcher commits on Control's keyUp), the wake/job cancel cards and the chat
 * tag confirm are anchored popovers, the agents page's discard bar is an inline
 * `alertdialog` in the pane, and the ask-drawer scrims are `absolute`, scoped to
 * one row. The census table with a verdict per file is in that pull request.
 *
 * WHAT IT ASSERTS, each the shape a hand-rolled modal cannot avoid:
 *
 *  M-1  NO `aria-modal` OUTSIDE THE PRIMITIVE, except `aria-modal="false"`.
 *       Radix sets `aria-modal` on the content it owns, so a source-level
 *       `aria-modal` (bare, `"true"` or an expression) is someone declaring a
 *       modal by hand. `"false"` is the explicit non-modal card and is allowed.
 *  M-2  NO WINDOW-COVERING SCRIM OUTSIDE THE PRIMITIVES. An element wearing both
 *       `bg-scrim` and `fixed` is a backdrop over the whole window - the job of
 *       `DialogOverlay` (and the sheet's overlay). A scrim scoped to a region is
 *       `absolute` and is not a modal backdrop.
 *  M-3  NO `showModal()`. A native `<dialog>` opened modally brings its own
 *       top-layer backdrop and panel, which the primitive's style never reaches.
 *  M-4  NO DIRECT RADIX DIALOG IMPORT OUTSIDE THE PRIMITIVES. Importing
 *       `Dialog`/`AlertDialog` from `radix-ui` (or the `@radix-ui/react-*dialog`
 *       packages) and rendering its `Content` is the other way to get a modal
 *       that looks nothing like the rest.
 *
 * Each rule has a negative control on a synthetic source (M-*b), so a refactor
 * that blinds a detector reds instead of passing vacuously.
 *
 * THE ESCAPE HATCH is `ALLOWED` below: a path, the rule and the reason. It starts
 * empty because nothing in the tree needs it; an entry that no longer matches an
 * offender fails (M-5), so the list cannot rot into blanket permission.
 *
 * Beyond its reach, on purpose: a class string composed at runtime, an inline
 * `style` scrim, and a modal built in a DOM builder rather than JSX. It promises
 * that the shapes this codebase writes are decisions, not that no modal can ever
 * be hand-rolled. Not in `GUARD_TESTS`: like `floating-surface-no-border`, it is
 * a tree walk the diff selection cannot reach, so it runs in the full suite -
 * which every pull request runs once at its merge gate - and in the desktop lane.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { openingTags } from "./jsx-opening-tags.mjs";

const ROOT = process.cwd();
const RENDERER = "src/renderer/src";
/** The primitive layer: the only place a modal's scrim and panel may be drawn. */
const UI_DIR = `${RENDERER}/shared/components/ui/`;
const cache = new Map();
/** Read once: four rules walk the same ~800 files. */
const read = (path) => {
	if (!cache.has(path)) cache.set(path, readFileSync(join(ROOT, path), "utf8"));
	return cache.get(path);
};

/**
 * `path -> { rule: reason }`. Empty: every modal in the tree is on the primitive.
 * Add an entry only with the reason the primitive cannot serve that surface.
 */
const ALLOWED = new Map();

/** Every renderer `.tsx`/`.ts` outside the primitive layer, minus stories and tests. */
const rendererFiles = (dir = RENDERER, out = []) => {
	for (const entry of readdirSync(join(ROOT, dir))) {
		const path = `${dir}/${entry}`;
		if (statSync(join(ROOT, path)).isDirectory()) rendererFiles(path, out);
		else if (
			(entry.endsWith(".tsx") || entry.endsWith(".ts")) &&
			!entry.includes(".stories.") &&
			!entry.includes(".test.") &&
			!path.startsWith(UI_DIR)
		)
			out.push(path);
	}
	return out;
};

/*
 * Comments are stripped before every match: these files explain at length why
 * they are NOT a modal ("no `showModal()`", "not a `<div role=dialog>`"), and a
 * guard that reds on that prose teaches people to delete it. The `(?<!:)` keeps
 * a `//` inside a URL from eating the rest of the line (same reasoning as
 * `floating-surface-no-border.test.mjs`).
 */
const stripComments = (source) =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");

const ARIA_MODAL = /(?<![\w-])aria-modal(?![\w-])(\s*=\s*("[^"]*"|\{[^}]*\}))?/;

/** M-1: an `aria-modal` that is anything but the literal `"false"`. */
const handDeclaredModals = (source) =>
	openingTags(source)
		.filter((tag) => {
			const match = stripComments(tag.text).match(ARIA_MODAL);
			return match !== null && match[2] !== '"false"';
		})
		.map(
			(tag) => `<${tag.name}> ${stripComments(tag.text).match(ARIA_MODAL)[0]}`,
		);

const SCRIM = /(?<![\w-])bg-scrim(?![\w-])/;
// A variant such as `md:fixed` still counts (`:` is not in the lookbehind);
// a compound such as `prefixed` or `fixed-header` does not.
const FIXED = /(?<![\w-])fixed(?![\w-])/;
const SHOW_MODAL = /\.showModal\s*\(/g;
const RADIX_NAMED_IMPORT =
	/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"radix-ui"/g;
const RADIX_DIALOG_PACKAGE = /from\s*"(@radix-ui\/react-(?:alert-)?dialog)"/g;
const AS_ALIAS = /\s+as\s+/;
const NON_MODAL = /aria-modal="false"/;

/** M-2: one element that is both the scrim colour and fixed to the window. */
const windowScrims = (source) =>
	openingTags(source)
		.filter((tag) => {
			const text = stripComments(tag.text);
			return SCRIM.test(text) && FIXED.test(text);
		})
		.map((tag) => `<${tag.name}> bg-scrim + fixed`);

/** M-3: a native dialog opened modally. */
const nativeModalCalls = (source) =>
	[...stripComments(source).matchAll(SHOW_MODAL)].map(() => "showModal()");

/** M-4: Radix's dialog parts imported past the primitive. */
const radixDialogImports = (source) => {
	const code = stripComments(source);
	const found = [];
	for (const match of code.matchAll(RADIX_NAMED_IMPORT)) {
		for (const name of match[1].split(",")) {
			const imported = name.trim().split(AS_ALIAS)[0];
			if (imported === "Dialog" || imported === "AlertDialog")
				found.push(`radix-ui ${imported}`);
		}
	}
	for (const match of code.matchAll(RADIX_DIALOG_PACKAGE)) found.push(match[1]);
	return found;
};

const RULES = {
	"M-1": handDeclaredModals,
	"M-2": windowScrims,
	"M-3": nativeModalCalls,
	"M-4": radixDialogImports,
};

const offendersFor = (rule) => {
	const offenders = [];
	for (const path of rendererFiles()) {
		if (ALLOWED.get(path)?.[rule]) continue;
		for (const hit of RULES[rule](read(path)))
			offenders.push(`${path}: ${hit}`);
	}
	return offenders;
};

const MESSAGE =
	"every centred modal renders through the shared dialog primitive (`DialogContent` from @shared/components/ui, or `BaseDialog`), so one restyle reaches all of them (operator request 2026-11-24). Move this surface onto the primitive; if it genuinely cannot be, add it to ALLOWED with the reason";

test("M-1 no hand-declared aria-modal outside the primitive", () => {
	const offenders = offendersFor("M-1");
	assert.deepEqual(offenders, [], `${MESSAGE}:\n${offenders.join("\n")}`);
});

test("M-2 no window-covering scrim outside the primitives", () => {
	const offenders = offendersFor("M-2");
	assert.deepEqual(offenders, [], `${MESSAGE}:\n${offenders.join("\n")}`);
});

test("M-3 no native showModal() in the renderer", () => {
	const offenders = offendersFor("M-3");
	assert.deepEqual(offenders, [], `${MESSAGE}:\n${offenders.join("\n")}`);
});

test("M-4 no direct Radix Dialog import outside the primitives", () => {
	const offenders = offendersFor("M-4");
	assert.deepEqual(offenders, [], `${MESSAGE}:\n${offenders.join("\n")}`);
});

test("M-1b..M-4b each detector fires on the shape it names, and not on its exemptions", () => {
	/*
	 * NEGATIVE CONTROLS. A detector that a refactor blinds would turn every rule
	 * above into a vacuous pass, so each one is shown the modal it exists to catch
	 * and the look-alike it must leave alone.
	 */
	assert.equal(
		handDeclaredModals('<div role="dialog" aria-modal="true" />').length,
		1,
	);
	assert.equal(
		handDeclaredModals('<section aria-modal role="dialog" />').length,
		1,
	);
	assert.equal(handDeclaredModals("<div aria-modal={open} />").length, 1);
	assert.equal(
		handDeclaredModals('<div role="dialog" aria-modal="false" />').length,
		0,
	);
	assert.equal(
		handDeclaredModals('<div className="x" /* aria-modal="true" */ />').length,
		0,
	);

	assert.equal(
		windowScrims('<div className="fixed inset-0 z-50 bg-scrim" />').length,
		1,
	);
	assert.equal(
		windowScrims('<div className="absolute inset-0 z-30 bg-scrim" />').length,
		0,
	);
	assert.equal(windowScrims('<div className="fixed bg-elevated" />').length, 0);

	assert.equal(nativeModalCalls("ref.current?.showModal();").length, 1);
	assert.equal(
		nativeModalCalls("// never ref.showModal() here\nx();").length,
		0,
	);

	assert.equal(
		radixDialogImports('import { Dialog as D, Popover } from "radix-ui";')
			.length,
		1,
	);
	assert.equal(
		radixDialogImports('import { AlertDialog } from "radix-ui";').length,
		1,
	);
	assert.equal(
		radixDialogImports('import * as D from "@radix-ui/react-dialog";').length,
		1,
	);
	assert.equal(
		radixDialogImports('import { Popover } from "radix-ui";').length,
		0,
	);
});

test("M-1c the walk reaches the renderer and leaves the primitive out", () => {
	/*
	 * The walk's own control: it must see the known non-modal cards (so M-1 is
	 * actually reading their tags) and must not see the primitive layer (which
	 * is the one place these shapes belong).
	 */
	const files = rendererFiles();
	assert.ok(
		files.includes(`${RENDERER}/features/phone-pairing/pairing-popup.tsx`),
	);
	assert.ok(
		files.includes(
			`${RENDERER}/features/session-switcher/components/session-switcher.tsx`,
		),
	);
	assert.ok(!files.some((path) => path.startsWith(UI_DIR)));
	const pairing = read(`${RENDERER}/features/phone-pairing/pairing-popup.tsx`);
	assert.ok(
		openingTags(pairing).some((tag) => NON_MODAL.test(tag.text)),
		"the pairing card's non-modal declaration should be visible to the walk",
	);
});

test("M-5 every ALLOWED entry still names a live offender", () => {
	const stale = [];
	for (const [path, rules] of ALLOWED) {
		for (const rule of Object.keys(rules)) {
			let hits = [];
			try {
				hits = RULES[rule](read(path));
			} catch {
				// A missing file is the stalest entry of all.
			}
			if (hits.length === 0) stale.push(`${path} (${rule})`);
		}
	}
	assert.deepEqual(
		stale,
		[],
		`remove the stale ALLOWED entries:\n${stale.join("\n")}`,
	);
});
