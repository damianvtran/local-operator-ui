/**
 * The New-project sheet says a taken key in the ACTIVE locale (i18n census N5).
 *
 *     node --test scripts/project-create-refusal-i18n.test.mjs
 *
 * WHY THIS SUITE EXISTS. The 2026-11-25 seven-locale re-census of main
 * b51b5d78 caught a Vietnamese create sheet reading `project 'alpha' already
 * exists`: the dialog showed the backend's English refusal as written, while
 * the route had declared the category on the wire (`detail.code` =
 * `project_name_exists`, which `desktopResult` lifts onto
 * `DesktopControlError.code`). The fix maps that code to the app's audited
 * sentence `ui.projects.project_edit_model.a_project_with_this_key_already_exists`
 * - the one the detail page's Key editor already shows.
 *
 * HOW: the REAL `ProjectFormDialog`, its real model modules and the real i18n
 * core render in jsdom; only presentation primitives (dialog chrome, inputs,
 * selects, markdown preview) are stubbed to plain elements, because the
 * refusal line is what is under test, not their styling. The locale is
 * switched to `vi` before the submit; the expected sentences are read from the
 * shipped catalogues so nothing here restates a translation.
 *
 * WHAT IT DOES NOT PROVE: pixels or the running app's wire; jsdom has no
 * layout, and the 409 body shape is the core route's (`desktop_projects.py`
 * `_refusal`), pinned on that side.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, afterEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const require = createRequire(import.meta.url);
const REACT_MODULE = /^(react|react-dom)(\/.*)?$/;
const STUBBED =
	/base-dialog$|common\/spinner$|shared\/components\/ui$|project-markdown$/;
const ANY_MODULE = /.*/;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/* jsdom has no layout, so no `scrollIntoView`; the sheet calls it to bring the
 * refusal line into view, which is geometry this file does not measure. */
window.HTMLElement.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");

/* Plain elements for the chrome; `{...rest}` keeps ids, values and handlers. */
const STUBS = {
	"base-dialog": `import React from "react";
export const BaseDialog = ({ open, title, children, actions }) =>
	open ? <div role="dialog" aria-label={title}>{children}{actions}</div> : null;
export const PrimaryButton = ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>;
export const SecondaryButton = PrimaryButton;`,
	spinner: "export const Spinner = () => null;",
	ui: `import React from "react";
export const Input = (props) => <input {...props} />;
export const Textarea = React.forwardRef((props, ref) => <textarea ref={ref} {...props} />);
export const Label = (props) => <label {...props} />;
export const Select = ({ children }) => <>{children}</>;
export const SelectTrigger = ({ children }) => <>{children}</>;
export const SelectContent = () => null;
export const SelectItem = () => null;
export const SelectValue = () => null;`,
	markdown: "export const ProjectMarkdown = () => null;",
};

const bundle = await build({
	stdin: {
		contents: [
			'export { ProjectFormDialog } from "./src/renderer/src/features/projects/components/project-form-dialog";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { setLocale } from "./src/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	/* `@shared/i18n` re-exports `src/i18n` by relative path, so the bundle
	 * holds ONE locale store - the one `setLocale` below switches. */
	alias: { "@shared": resolve("src/renderer/src/shared") },
	plugins: [
		{
			name: "project-dialog-boundaries",
			setup(builder) {
				builder.onResolve({ filter: STUBBED }, (args) => ({
					path: args.path,
					namespace: "stub",
				}));
				builder.onLoad(
					{ filter: ANY_MODULE, namespace: "stub" },
					({ path }) => ({
						contents: path.endsWith("base-dialog")
							? STUBS["base-dialog"]
							: path.endsWith("spinner")
								? STUBS.spinner
								: path.endsWith("project-markdown")
									? STUBS.markdown
									: STUBS.ui,
						loader: "tsx",
						resolveDir: process.cwd(),
					}),
				);
				/* One React for the bundle and this file (hooks need a singleton). */
				builder.onResolve({ filter: REACT_MODULE }, (args) => ({
					path: pathToFileURL(require.resolve(args.path)).href,
					external: true,
				}));
			},
		},
	],
});
const { ProjectFormDialog, DesktopControlError, setLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=project-create-refusal-fixture.mjs`).toString("base64")}`
);

const catalogue = (locale) =>
	JSON.parse(
		readFileSync(
			resolve(`src/i18n/catalogues/${locale}/ui.projects.json`),
			"utf8",
		),
	);
const TAKEN_KEY =
	"ui.projects.project_edit_model.a_project_with_this_key_already_exists";
const NOT_SAVED = "ui.projects.project_form_dialog.the_project_was_not_saved";
const SERVER_SENTENCE = "project 'alpha' already exists";

afterEach(() => setLocale("en"));
after(() => dom.window.close());

/** Mount the sheet, type a title, submit; resolve the refusal line's text. */
async function refusalAfterSubmit(t, rejectWith) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	await act(async () =>
		root.render(
			React.createElement(ProjectFormDialog, {
				open: true,
				onClose: () => {},
				onSubmit: async () => {
					throw rejectWith;
				},
			}),
		),
	);
	const title = container.querySelector("[data-project-title]");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		).set.call(title, "alpha");
		title.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	assert.equal(container.querySelector("[data-project-key]").value, "alpha");
	await act(async () =>
		container
			.querySelector("[data-project-submit]")
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
	);
	return container.querySelector("p.text-danger")?.textContent ?? null;
}

test("N5: a taken key reads in Vietnamese, not the server's English", async (t) => {
	setLocale("vi");
	const text = await refusalAfterSubmit(
		t,
		new DesktopControlError(
			409,
			SERVER_SENTENCE,
			undefined,
			"project_name_exists",
		),
	);
	assert.notEqual(text, SERVER_SENTENCE, "the backend's English is not shown");
	assert.equal(text, catalogue("vi")[TAKEN_KEY]);
});

test("N5: the same code reads in English under en", async (t) => {
	const text = await refusalAfterSubmit(
		t,
		new DesktopControlError(
			409,
			SERVER_SENTENCE,
			undefined,
			"project_name_exists",
		),
	);
	assert.equal(text, catalogue("en")[TAKEN_KEY]);
});

test("unmapped refusals keep the fallback: message as written, else the sheet's own sentence", async (t) => {
	setLocale("vi");
	/*
	 * `project_invalid` is no longer unmapped (i18n slice a maps it by code to
	 * `ui.projects.project_refusals.project_invalid`, pinned in
	 * `scripts/i18n-projects-remote-literals.test.mjs`), so the as-written
	 * fallback is exercised with a code the mapping does not know.
	 */
	assert.equal(
		await refusalAfterSubmit(
			t,
			new DesktopControlError(
				422,
				"target_date must not precede start_date",
				undefined,
				"project_some_future_code",
			),
		),
		"target_date must not precede start_date",
	);
	assert.notEqual(
		await refusalAfterSubmit(
			t,
			new DesktopControlError(
				422,
				"target_date must not precede start_date",
				undefined,
				"project_invalid",
			),
		),
		"target_date must not precede start_date",
		"project_invalid is mapped by code, never shown as the backend's English",
	);
	assert.equal(
		await refusalAfterSubmit(t, new Error("")),
		catalogue("vi")[NOT_SAVED],
	);
});
