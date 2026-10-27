/*
 * The palette's language dialog COMMITS ON PICK, and closing it cannot drop a
 * pick (defect: "I switched to fr and the UI stayed English").
 *
 * THE DEFECT THIS FILE PINS. The dialog is the SAME editor as the General
 * settings row — one registry row, one `SettingControl` — but it used to keep a
 * local draft and write only when Save was pressed. Selecting a language and
 * closing the dialog (which is what a reader does after the picker shows the
 * new language) therefore made no request at all: the operator's pick was
 * silently discarded, and the app's access log showed ZERO settings writes.
 * The row writes on selection; the dialog must obey the same contract, or the
 * two doors to one setting disagree.
 *
 * WHY THE PICKER IS A DOUBLE HERE. The shipped control is Radix's portalled
 * listbox, and this repo's jsdom suites record that it commits to no synthetic
 * event jsdom can produce (see `language-dialog.test.mjs` and
 * `settings-language-row.test.mjs`). The seam under test is not Radix's pointer
 * handling — it is what the DIALOG does with the value its picker reports — so
 * the bundle rewrites only the dialog's `./setting-control` import to a native
 * `<select>` that calls the same `onValueChange`. Everything else (the dialog,
 * its store wiring, `saveImmediateLanguageValue`, `renegotiateLanguage`, the
 * query cache) is the shipped code. The rewrite asserts the marker occurs
 * exactly once, the same shape the repo's module-mutation tests use.
 *
 * The negative control is real: run this file against the base dialog (draft +
 * Save) and the first case fails on "no Save", the write assertion, and the
 * locale assertion — the pick never becomes a request.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom's accessors refuse out-of-context reads; the needed ones do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/* --------------------------------------------------------------- bridge */

const apiCalls = [];
const FIXTURE = "scripts/fixtures/backend-settings-registry-configured.json";

/** The backend's language setting, the one value `settings.edit` moves. */
let backendLanguage = "en";
/** Latency on `settings.edit`, so a case can close the dialog mid-write. */
let editDelayMs = 0;
/** A rejection message, or null for an accepted write. */
let editFailure = null;
/**
 * A refusal message on the readback `settings.list`, or null for the ordinary
 * answer. QA round 1 (Q1): the WRITE can land while the READBACK fails, and the
 * dialog must not read that as a server that never answered at all.
 */
let readbackFailure = null;

const settingsPayload = () => {
	const payload = JSON.parse(readFileSync(FIXTURE, "utf8"));
	const row = payload.settings.find((setting) => setting.key === "language");
	row.value = backendLanguage;
	return payload;
};

const desktopRequest = async (request) => {
	apiCalls.push({ ...request });
	switch (request?.op) {
		case "capabilities":
			return {
				status: 200,
				body: {
					result: {
						desktop_available: true,
						features: { settings: 1, i18n: 1 },
						language: backendLanguage,
					},
				},
			};
		case "settings.list":
			if (readbackFailure) {
				return {
					status: 503,
					body: { status: 503, detail: { message: readbackFailure } },
				};
			}
			return { status: 200, body: { result: settingsPayload() } };
		case "settings.edit": {
			if (editDelayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, editDelayMs));
			}
			if (editFailure) {
				return {
					status: 422,
					body: { status: 422, detail: { message: editFailure } },
				};
			}
			if (request.key === "language") {
				backendLanguage = String(request.value);
			}
			return { status: 200, body: { result: {} } };
		}
		default:
			throw new Error(
				`language-dialog-applies-on-pick: unstubbed ${request.op}`,
			);
	}
};

globalThis.window.api = { desktop: { request: desktopRequest } };

/* --------------------------------------------------------------- bundle */

/*
 * The driveable picker. It re-exports everything the dialog needs from the
 * real control module (`export *`), then SHADOWS `SettingControl` with a
 * native select that reports through the same `onValueChange` prop the Radix
 * control calls. Explicit exports win over a star export, so the dialog gets
 * this one and the rest of the module stays shipped code.
 */
const PICKER_STUB = `
export {
	DIALOG_EFFECTIVE_SURFACE,
	languageIdentifierFor,
	settingEffectiveId,
	settingEffectiveIdFor,
} from "./setting-control";

export const SettingControl = ({ setting, value, disabled = false, onValueChange }) => (
	<select
		data-test-language-picker=""
		value={value}
		disabled={disabled}
		onChange={(event) => onValueChange(event.currentTarget.value)}
	>
		{setting.choices.map((choice) => (
			<option key={String(choice.value)} value={String(choice.value)}>
				{choice.label || String(choice.value)}
			</option>
		))}
	</select>
);
`;

const DIALOG_MODULE = /language-dialog\.tsx$/;
const ANY_PATH = /.*/;
const CONTROL_IMPORT = '"./setting-control"';
const toastStub = new URL("language-live-toast-stub.mjs", import.meta.url)
	.pathname;

const bundle = await build({
	stdin: {
		contents: [
			'import { createElement } from "react";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
			'export { LanguageDialog } from "./src/renderer/src/features/settings/components/language-dialog";',
			'export { useLanguageDialogStore } from "./src/renderer/src/features/settings/components/language-dialog-store";',
			'export { useI18nLocaleSync } from "./src/renderer/src/shared/i18n/locale-sync";',
			'export { currentLocale, t } from "./src/renderer/src/shared/i18n";',
			'export { errorCalls } from "./scripts/language-live-toast-stub.mjs";',
			"export { createElement };",
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@shared/utils/toast-manager": toastStub,
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
	plugins: [
		{
			name: "driveable-language-picker",
			setup(builder) {
				builder.onLoad({ filter: DIALOG_MODULE }, ({ path }) => {
					const source = readFileSync(path, "utf8");
					assert.equal(
						source.split(CONTROL_IMPORT).length,
						2,
						"rewrite exactly the dialog's one import of the shared control",
					);
					return {
						contents: source.replace(CONTROL_IMPORT, '"picker-under-test"'),
						loader: "tsx",
						resolveDir: path.replace(/\/[^/]+$/, ""),
					};
				});
				builder.onResolve({ filter: /^picker-under-test$/ }, () => ({
					path: "picker-under-test",
					namespace: "picker",
				}));
				builder.onLoad({ filter: ANY_PATH, namespace: "picker" }, () => ({
					contents: PICKER_STUB,
					loader: "tsx",
					resolveDir: "src/renderer/src/features/settings/components",
				}));
			},
		},
	],
});

const bundlePath = new URL(
	"_language-dialog-applies-on-pick.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	LanguageDialog,
	useLanguageDialogStore,
	useI18nLocaleSync,
	currentLocale,
	t: translate,
	errorCalls,
} = await import(bundlePath.href);

const LocaleSync = () => {
	useI18nLocaleSync();
	return null;
};

const TEST_TIMEOUT_MS = 60_000;

const settle = async (cond, note, ms = 5000) => {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (cond()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
	assert.ok(cond(), note);
};

const mount = async (t) => {
	apiCalls.length = 0;
	backendLanguage = "en";
	editDelayMs = 0;
	editFailure = null;
	readbackFailure = null;
	errorCalls.length = 0;
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			gcTime: 0,
		},
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => {
			root.unmount();
		});
		client.clear();
		container.remove();
	});
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					React.Fragment,
					null,
					createElement(LanguageDialog, null),
					createElement(LocaleSync, null),
				),
			),
		);
	});
	return { client, container };
};

const openDialog = async () => {
	await act(async () => {
		useLanguageDialogStore.getState().openLanguage();
	});
	await settle(
		() => Boolean(document.querySelector("[data-test-language-picker]")),
		"the dialog's picker must render",
	);
	await settle(
		() => currentLocale() === backendLanguage,
		"the store must seed",
	);
};

/*
 * Set a select's value the way a reader does, bypassing React's instance-level
 * value tracker; a plain assignment updates the tracker and React then reads
 * the change as none. This is the standard DOM-driven form of the interaction.
 */
const pick = async (value) => {
	const picker = document.querySelector("[data-test-language-picker]");
	assert.ok(picker, "the picker must be mounted to pick");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			bootstrapDOM.window.HTMLSelectElement.prototype,
			"value",
		).set.call(picker, value);
		picker.dispatchEvent(
			new bootstrapDOM.window.Event("change", { bubbles: true }),
		);
	});
};

const edits = () =>
	apiCalls.filter(
		(call) => call.op === "settings.edit" && call.key === "language",
	);

/* ---------------------------------------------------------------- cases */

test(
	"picking a language commits at selection, and closing cannot discard it",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t);
		await openDialog();
		/* The write is in flight when the reader closes: the pick still lands. */
		editDelayMs = 150;
		await pick("fr");
		/*
		 * Asserted BEFORE the close. This case's job is to tell commit-on-pick
		 * from commit-on-close, and an assertion made after the close cannot: a
		 * write deferred to `open === false` would satisfy it (R1-3, where the
		 * message promised a distinction the ordering did not make).
		 */
		await settle(
			() => edits().length === 1,
			"the pick must reach settings.edit at selection, with no Save pressed",
		);
		assert.deepEqual(
			{ op: edits()[0].op, key: edits()[0].key, value: edits()[0].value },
			{ op: "settings.edit", key: "language", value: "fr" },
		);
		await act(async () => {
			useLanguageDialogStore.getState().closeLanguage();
		});
		assert.equal(
			document.querySelector('[role="dialog"]'),
			null,
			"the dialog must be closed before the write settles",
		);
		await settle(
			() => currentLocale() === "fr",
			"the capabilities answer must move the interface to fr",
		);
		assert.equal(
			edits().length,
			1,
			"closing mid-write must neither drop nor re-issue the pick",
		);
		assert.equal(errorCalls.length, 0, "a successful write stays quiet");
		/*
		 * The dialog's contract is the row's: no Save step, so there is nothing
		 * a close could drop. The base dialog renders this button; that is the
		 * defect's shape.
		 */
		assert.equal(
			[...document.querySelectorAll("button")].filter(
				(button) => button.textContent.trim() === "Save",
			).length,
			0,
			"the dialog must not carry a separate Save step",
		);
	},
);

test(
	"a rejected pick while the dialog is open says so in place and does not toast",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t);
		await openDialog();
		editFailure = "the backend refused the write";
		await pick("fr");
		await settle(
			() => Boolean(document.querySelector('[role="alert"]')),
			"a rejected write must render its refusal in the dialog",
		);
		assert.ok(
			document.body.textContent.includes("The language was not saved"),
			"the refusal must say the pick did not apply",
		);
		assert.ok(
			document.body.textContent.includes("the backend refused the write"),
			"the refusal must carry the backend's own message",
		);
		assert.equal(
			errorCalls.length,
			0,
			"an open dialog reports in place rather than through a toast",
		);
		assert.equal(
			document.querySelector("[data-test-language-picker]").disabled,
			false,
			"the picker must be usable again after the refusal",
		);
		/*
		 * A rejected write must not leave the UI CLAIMING the new language. Both
		 * surfaces the stub suite can see must stay on committed truth: the
		 * picker's rendered value, and the app locale `useI18nLocaleSync` drives
		 * (R1-2 — the claim held by construction and nothing pinned it, so an
		 * optimistic local value kept on failure passed every case). The
		 * picker's effective-note caption is NOT assertable here: this suite
		 * replaces `SettingControl` wholesale, and the note is that control's.
		 */
		assert.equal(
			document.querySelector("[data-test-language-picker]").value,
			"en",
			"a rejected write must leave the picker on the committed locale",
		);
		assert.equal(
			currentLocale(),
			"en",
			"the interface must stay on the committed locale after a refusal",
		);
	},
);

test(
	"a rejection that lands after close is announced, not swallowed",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t);
		await openDialog();
		editDelayMs = 150;
		editFailure = "the backend refused the write";
		await pick("fr");
		await act(async () => {
			useLanguageDialogStore.getState().closeLanguage();
		});
		await settle(
			() => errorCalls.length === 1,
			"a write that fails after the dialog closed must surface once",
		);
		assert.ok(
			errorCalls[0].message.includes("The language was not saved"),
			"the announcement must say the language did not change",
		);
		assert.ok(
			errorCalls[0].message.includes("the backend refused the write"),
			"the announcement must carry the backend's own message",
		);
		assert.equal(
			currentLocale(),
			"en",
			"the interface stays on the old locale",
		);
	},
);

/*
 * A CONFIRMED WRITE WITH A FAILED READBACK IS NOT A DEAD SERVER (QA round 1, Q1).
 *
 * The write answers 200 and the locale moves to fr; the readback `settings.list`
 * then fails. Both facts hold at once, and the dialog used to collapse them into
 * the cold-load screen - "Your settings could not be loaded." - which is false:
 * the server answered, and what it answered was written. The picker vanished
 * with that screen, so the one surface that can say the write was confirmed but
 * the state unverified (the row's readback warning) was unreachable.
 *
 * The assertion is deliberately a PAIR: the readback sentence present AND the
 * load-failure sentence absent. Either alone also passes on a screen that says
 * both, or on one that says neither.
 */
test(
	"a confirmed write with a failed readback warns about the readback, not a dead server",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t);
		await openDialog();
		readbackFailure = "the readback GET failed";
		await pick("fr");
		/*
		 * Both sentences are read from the catalogue rather than typed here: the
		 * confirmed write has already moved the interface to fr, so the dialog's
		 * copy under test is French. A hardcoded English sentence would pass by
		 * finding nothing, in the locale this very case produces.
		 */
		const readbackCopy = translate(
			"ui.settings.language.general.readback_error",
		);
		const loadFailureCopy = translate(
			"ui.settings.configuration.language_dialog.your_settings_could_not_be_loaded",
		);
		await settle(
			() => document.body.textContent.includes(readbackCopy),
			"the readback's own warning must be the first screen after a confirmed write",
		);
		assert.equal(
			document.body.textContent.includes(loadFailureCopy),
			false,
			"a failed readback is not a failed load: the server answered the write",
		);
		const picker = document.querySelector("[data-test-language-picker]");
		assert.ok(picker, "the picker the write used stays on screen");
		assert.equal(
			picker.disabled,
			true,
			"an unverified readback must refuse a further pick",
		);
		assert.equal(edits().length, 1, "the confirmed write is not re-issued");
		assert.equal(backendLanguage, "fr", "the write landed");
		assert.equal(
			currentLocale(),
			"fr",
			"the interface follows the confirmed write",
		);
	},
);
