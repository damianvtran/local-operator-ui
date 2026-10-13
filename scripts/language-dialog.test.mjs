/*
 * The palette's language dialog (i18n slice B2): the same enum + note as the
 * settings row, writing through the same seam.
 *
 * Two cases. The FIRST is the dialog's render contract: it opens closed,
 * shows the registry row's control and the `In effect:` note, and keeps Save
 * disabled while nothing is dirty. The SECOND exercises the extracted
 * `saveLanguageValue` seam - the exact function the Save button calls - and
 * proves the write reaches `settings.edit`, renegotiates the capabilities
 * chain, and moves the store (and the note) to the new language.
 *
 * WHY THE SEAM AND NOT A CLICKED PICKER: Radix's portalled listbox commits to
 * no synthetic event jsdom can produce (keyboard focus lands on the container,
 * mouse-typed pointer events, clicks and native-select bridging were each
 * tried), which is the same boundary `settings-language-row.test.mjs` records
 * for the settings row - where the reset button, not the picker, drives the
 * write. Extracting the save as a function keeps the clicked path honest: the
 * button's onClick is `saveLanguageValue({ value, queryClient })` and nothing
 * else.
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

const apiCalls = [];
/*
 * The capabilities answer's behaviour per case (round 2, R2-1): `ok` is the
 * shipped answer, `hang` is a backend that never speaks, `error` is one that
 * fails cold. A case may also flip this DURING a run to model a failure
 * arriving after an earlier answer (the prior-data rule).
 */
let capabilitiesBehavior = { type: "ok", features: { settings: 1, i18n: 1 } };
const setCapabilitiesBehavior = (behavior) => {
	capabilitiesBehavior = behavior;
};
/*
 * The R3-1 teardown handle: a `hang` reply is a never-settling promise, and a
 * pending in-flight request keeps a 300 s timer alive in the bridge - the file
 * then sits for five minutes after its last assertion and every direct run,
 * `pnpm test:desktop` and CI pay it. The stub therefore keeps the resolver,
 * and `mount`'s teardown settles it: the reply lands (an error, which is what
 * a backend that stopped talking deserves) and the timer goes with it.
 */
let pendingCapabilitiesReply = null;
const settlePendingCapabilities = () => {
	if (pendingCapabilitiesReply) {
		pendingCapabilitiesReply({
			status: 503,
			body: { status: 503, message: "Teardown: the stub stopped answering." },
		});
		pendingCapabilitiesReply = null;
	}
};
/* Mutable, so a case can move the server's value the way a refetch would. */
const settingsPayload = () =>
	JSON.parse(
		readFileSync(
			"scripts/fixtures/backend-settings-registry-configured.json",
			"utf8",
		),
	);
const setServerLanguageValue = (value) => {
	const payload = settingsPayload();
	const row = payload.settings.find((s) => s.key === "language");
	row.value = value;
	const client = lastClient;
	if (client) {
		client.setQueryData(["desktop", "settings"], payload);
	}
};
let lastClient = null;
let capabilitiesLanguage = "en";
const setCapabilitiesLanguage = (language) => {
	capabilitiesLanguage = language;
};

/*
 * The default desktop stub, installed ONCE and never overwritten in place.
 *
 * A case that needs its own answers does not assign to
 * `window.api.desktop.request`; it calls `withDesktopStub` and the default is
 * restored when the case ends. WHY THIS IS A HELPER RATHER THAN A CONVENTION:
 * the first version of the General test assigned a whole new `request` onto the
 * global and never put the default back, so the three tests AFTER it ran
 * against a stub that threw on `settings.list` - each failing on `the store
 * must be seeded` / `no Retry rendered`, none of them about the code they
 * meant to test. Global state leaking between cases is the failure mode; the
 * helper is what makes restoring it the default rather than a remembered step.
 */
const defaultDesktopRequest = async (request) => {
	apiCalls.push({ ...request });
	if (request?.op === "capabilities") {
		if (capabilitiesBehavior.type === "hang") {
			return new Promise((resolve) => {
				pendingCapabilitiesReply = resolve;
			});
		}
		if (capabilitiesBehavior.type === "error") {
			return {
				status: 503,
				body: { status: 503, message: "The server is not answering." },
			};
		}
		return {
			status: 200,
			body: {
				result: {
					desktop_available: true,
					features: capabilitiesBehavior.features,
					language: capabilitiesLanguage,
				},
			},
		};
	}
	if (request?.op === "settings.list") {
		return { status: 200, body: { result: settingsPayload() } };
	}
	return { status: 200, body: { result: {} } };
};

globalThis.window.api = {
	desktop: {
		request: defaultDesktopRequest,
	},
};

/*
 * Run `body` with a temporary desktop stub, restoring the default afterwards
 * even when the body throws. The stub still records into `apiCalls`, so a case
 * that swaps in behaviour keeps the same call log the assertions read.
 */
const withDesktopStub = async (request, body) => {
	window.api.desktop.request = async (incoming) => {
		apiCalls.push({ ...incoming });
		return request(incoming);
	};
	try {
		return await body();
	} finally {
		window.api.desktop.request = defaultDesktopRequest;
	}
};

const bundle = await build({
	stdin: {
		contents: [
			'import { createElement } from "react";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
			'export { LanguageDialog, saveImmediateLanguageValue, saveLanguageValue, GeneralLanguageSetting } from "./src/renderer/src/features/settings/components/language-dialog";',
			'export { useLanguageDialogStore } from "./src/renderer/src/features/settings/components/language-dialog-store";',
			'export { useI18nLocaleSync } from "./src/renderer/src/shared/i18n/locale-sync";',
			'export { applyCapabilities, currentLocale } from "./src/renderer/src/shared/i18n";',
			'export { languageChoices } from "./src/renderer/src/features/settings/components/setting-control";',
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
});

const bundlePath = new URL("_language-dialog.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	LanguageDialog,
	saveImmediateLanguageValue,
	saveLanguageValue,
	GeneralLanguageSetting,
	useLanguageDialogStore,
	useI18nLocaleSync,
	applyCapabilities,
	currentLocale,
	languageChoices,
} = await import(bundlePath.href);

/* The app mounts this once; without it nothing feeds the store. */
const LocaleSync = () => {
	useI18nLocaleSync();
	return null;
};

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

const TEST_TIMEOUT_MS = 60_000;

const mount = async (
	t,
	capabilities = { type: "ok", features: { settings: 1, i18n: 1 } },
) => {
	applyCapabilities(null);
	setCapabilitiesLanguage("en");
	/* Set BEFORE the tree renders: the capabilities fetch is the first op. */
	setCapabilitiesBehavior(capabilities);
	apiCalls.length = 0;
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
		/* Settle a hanging capabilities stub first, so its bridge timer clears. */
		settlePendingCapabilities();
		try {
			await act(async () => {
				root.unmount();
			});
		} finally {
			client.clear();
		}
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
	lastClient = client;
	return { client };
};

const mountGeneral = async (t) => {
	applyCapabilities(null);
	setCapabilitiesLanguage("en");
	setCapabilitiesBehavior({ type: "ok", features: { settings: 1, i18n: 1 } });
	apiCalls.length = 0;
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
		settlePendingCapabilities();
		try {
			await act(async () => {
				root.unmount();
			});
		} finally {
			client.clear();
		}
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
					createElement(GeneralLanguageSetting, { focus: true }),
					createElement(LocaleSync, null),
				),
			),
		);
	});
	lastClient = client;
	return { client };
};

test(
	"the General control writes immediately, stays on committed truth and names readback uncertainty",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		const { client } = await mountGeneral(t);
		await settle(
			() => Boolean(document.querySelector("[data-setting-key=language]")),
			"the General language control must render",
		);
		await settle(() => currentLocale() === "en", "the store must be seeded");
		/*
		 * Availability is the SERVER's answer, not the app's eight-name table:
		 * this fixture ships `auto` + `en`, so the audited-but-absent locales
		 * must come back disabled rather than offered as selectable.
		 */
		const choiceRow = settingsPayload().settings.find(
			(row) => row.key === "language",
		);
		const offered = languageChoices(choiceRow);
		assert.deepEqual(
			offered.filter((choice) => choice.enabled).map((choice) => choice.value),
			["auto", "en"],
			"only the choices this server actually serves are selectable",
		);
		for (const value of ["zh-CN", "ur", "fr"]) {
			assert.equal(
				offered.find((choice) => choice.value === value).enabled,
				false,
				`${value} is offered as an unavailable option, never a selectable one`,
			);
		}
		/* The status line states the BACKEND's resolved language, not the client OS guess. */
		const status = document.querySelector("[data-setting-key=language] output");
		assert.ok(
			status?.textContent.includes("en"),
			"the effective note reports the backend-resolved locale",
		);
		const edits = () => apiCalls.filter((call) => call.op === "settings.edit");
		const refuseEdit = async (request) => {
			if (request?.op === "settings.edit")
				return { status: 422, body: { status: 422, message: "refused" } };
			if (request?.op === "settings.list")
				return { status: 200, body: { result: settingsPayload() } };
			if (request?.op === "capabilities")
				return {
					status: 200,
					body: {
						result: {
							desktop_available: true,
							desktop_contract: 1,
							desktop_auth: "bearer",
							features: { settings: 1, i18n: 1 },
							language: capabilitiesLanguage,
						},
					},
				};
			return { status: 200, body: { result: {} } };
		};
		await withDesktopStub(refuseEdit, async () => {
			await act(async () => {
				await saveImmediateLanguageValue({
					value: "en",
					queryClient: client,
				}).catch(() => {});
			});
		});
		/* Only a CONFIRMED value is cached; the committed row is untouched. */
		const cached = client.getQueryData(["desktop", "settings"]);
		assert.equal(
			cached.settings.find((row) => row.key === "language").value,
			"auto",
			"a rejected write must not be presented as the committed setting",
		);
		await settle(
			() => Boolean(document.querySelector('[role="combobox"]')),
			"the server-driven choice control must render for the tested row",
		);
		/* A write that lands but cannot be read back is its own state. */
		const outcome = await withDesktopStub(
			async (request) => {
				if (request?.op === "settings.list") throw new Error("offline");
				return { status: 200, body: { result: {} } };
			},
			() =>
				saveImmediateLanguageValue({
					value: "en",
					queryClient: client,
				}),
		);
		assert.equal(
			outcome,
			"readback-unknown",
			"a confirmed write without a readable answer is not silently a success",
		);
		assert.equal(
			edits().some((call) => call.key === "language"),
			true,
		);
	},
);

test(
	"the dialog shows the row's control and note, closed until asked, Save clean",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t);
		assert.equal(document.querySelector('[role="dialog"]'), null);

		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		/*
		 * THE DIALOG'S OWN ID, and the identical note. QA round 5 (Q5) gave this
		 * picker a surface-scoped id (`setting-effective-language-dialog`) because
		 * it can be co-mounted with the General section, whose caption holds the
		 * canonical `setting-effective-language`; two elements with one id would
		 * make each picker's `aria-describedby` resolve to the other's caption.
		 * The assertion below is the SAME assertion it always was — the note
		 * renders with the same text — pointed at the id this surface now owns.
		 */
		const DIALOG_NOTE = "#setting-effective-language-dialog";
		await settle(
			() => Boolean(document.querySelector(DIALOG_NOTE)),
			"the same note as the row must render",
		);
		await settle(() => currentLocale() === "en", "the store must be seeded");
		assert.ok(
			document.body.textContent.includes("Interface language"),
			"the title must render",
		);
		assert.equal(
			document.querySelector(DIALOG_NOTE).textContent,
			"In effect: en",
		);
		const saveButton = document.querySelector("[data-language-save]");
		assert.ok(saveButton, "the save button must render");
		assert.ok(saveButton.disabled, "Save must be disabled while clean");
	},
);

test(
	"a prior open plus an external change refuses to become a phantom draft",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t);
		await settle(() => currentLocale() === "en", "the store must be seeded");
		const triggerText = () =>
			document.querySelector('[role="combobox"]')?.textContent ?? "";
		const saveButton = () => document.querySelector("[data-language-save]");

		/*
		 * The label the trigger shows is the SHARED control's, so this PR moved
		 * `auto` from the raw wire value to the reader-facing "Use system" the
		 * General control renders (see `LanguageChoiceLabel`). The assertions
		 * track the VALUE through that label rather than the raw token: `auto`
		 * is "Use system", and a served `en` is "English". Asserting the old
		 * raw `auto` here would pin copy the product deliberately reworded.
		 */
		const AUTO_LABEL = "Use system";
		const EN_LABEL = "English";
		// First open: seeds the server's value and Save stays clean.
		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		await settle(() => triggerText().includes(AUTO_LABEL), "first seed");
		assert.ok(saveButton().disabled, "clean after the first seed");

		/*
		 * Close, then the server moves (a refetch would land this value). The
		 * values move WITHIN the shipped space - `auto` and `en` are the two
		 * choices the wire serves today, and a value outside a select's items
		 * renders blank, which is the value space's rule rather than this
		 * case's.
		 */
		await act(async () => {
			useLanguageDialogStore.getState().closeLanguage();
		});
		await act(async () => {
			setServerLanguageValue("en");
		});

		/*
		 * Re-open: the draft must reset to the NEW server value, with Save
		 * clean - a stale `auto` kept from the prior open would be a phantom
		 * dirty edit whose Save writes the old value back over the external
		 * change (round 1, R1-2).
		 */
		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		await settle(() => triggerText().includes(EN_LABEL), "re-seed to en");
		assert.ok(
			saveButton().disabled,
			"no phantom dirty draft after an external change",
		);

		// And while OPEN and clean, the draft follows the server again.
		await act(async () => {
			setServerLanguageValue("auto");
		});
		await settle(() => triggerText().includes(AUTO_LABEL), "follow while open");
		assert.ok(saveButton().disabled, "still clean after the follow");
	},
);

test(
	"a backend that has not answered shows strictly loading, not a refusal",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t, { type: "hang" });
		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		await settle(
			() => document.body.textContent.includes("Loading the current setting"),
			"an unanswered backend must read as loading",
		);
		/* The R2-1 defect: this sentence used to run for a backend mid-handshake. */
		assert.ok(
			!document.body.textContent.includes("does not serve the settings"),
			"no refusal sentence before an answer exists",
		);
		assert.equal(
			[...document.querySelectorAll("button")].filter(
				(button) => button.textContent.trim() === "Retry",
			).length,
			0,
			"no Retry for a query that is still asking",
		);
	},
);

test(
	"a settled answer without the feature is the refusal, and stays one after a later failure",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		const { client } = await mount(t, { type: "ok", features: { i18n: 1 } });
		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		await settle(
			() => document.body.textContent.includes("does not serve the settings"),
			"an answered backend without the feature must refuse",
		);
		assert.ok(
			!document.body.textContent.includes("Loading the current setting"),
			"a refusal is not a loading state",
		);
		/*
		 * The prior-data rule (R2-1): a refetch that FAILS after an answer
		 * keeps the answer - the refusal must not turn into the pairing
		 * sentence, and the dialog must not fall back to "Loading".
		 */
		setCapabilitiesBehavior({ type: "error" });
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["desktop", "capabilities"] });
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 250));
		});
		assert.ok(
			document.body.textContent.includes("does not serve the settings"),
			"an earlier refusal survives a failed refetch",
		);
		assert.ok(
			!document.body.textContent.includes("Your settings could not be loaded."),
			"prior data means the failure is not the cold-failure sentence",
		);
	},
);

test(
	"a cold failure renders the pairing sentence and a reachable Retry",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mount(t, { type: "error" });
		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		const retry = await (async () => {
			const start = Date.now();
			for (;;) {
				const button = [...document.querySelectorAll("button")].find(
					(candidate) => candidate.textContent.trim() === "Retry",
				);
				if (button) return button;
				if (Date.now() - start > 5000) {
					throw new Error("no Retry rendered for a cold failure");
				}
				await act(async () => {
					await new Promise((resolve) => setTimeout(resolve, 25));
				});
			}
		})();
		/* D8: the first Enter must reach the Retry, not the container. */
		await settle(
			() => document.activeElement === retry,
			"focus lands on the Retry control",
		);
		const before = apiCalls.filter((call) => call.op === "capabilities").length;
		await act(async () => {
			retry.dispatchEvent(
				new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
			);
		});
		await settle(
			() =>
				apiCalls.filter((call) => call.op === "capabilities").length > before,
			"the Retry arm must actually re-ask capabilities",
		);
	},
);

test(
	"the save seam writes the one setting and renegotiates the chain",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		const { client } = await mount(t);
		await settle(() => currentLocale() === "en", "the store must be seeded");
		const edits = () => apiCalls.filter((call) => call.op === "settings.edit");
		assert.equal(edits().length, 0, "no edit before the save");
		setCapabilitiesLanguage("fr");
		await act(async () => {
			await saveLanguageValue({ value: "fr", queryClient: client });
		});
		await settle(
			() => edits().length === 1,
			"the save must write through settings.edit",
		);
		assert.deepEqual(
			{ op: edits()[0].op, key: edits()[0].key, value: edits()[0].value },
			{ op: "settings.edit", key: "language", value: "fr" },
		);
		await settle(
			() => currentLocale() === "fr",
			"the capabilities answer must move the store",
		);
	},
);

/**
 * A CO-MOUNTED PAIR HAS EXACTLY ONE ELEMENT PER CAPTION ID (QA round 5, Q5).
 *
 * The General section and the palette dialog can be mounted at the same time —
 * open the dialog from the palette while `/settings` is up — and each renders a
 * picker whose `aria-describedby` must resolve to ITS OWN caption. Before this
 * fix both emitters used the canonical `setting-effective-language`, so
 * `getElementById` answered with whichever came first and one picker described
 * the other surface's note.
 *
 * The invariant this pins is the one that cannot be satisfied by accident: at
 * most one element carries each surface's id, and each picker's describedby
 * points at a real element inside that picker's OWN region. Asserting the ids
 * alone would pass for two elements sharing one; asserting only describedby
 * would pass for a dangling reference.
 */
test(
	"a co-mounted General row and palette dialog never share a caption id",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		await mountGeneral(t);
		await act(async () => {
			useLanguageDialogStore.getState().openLanguage();
		});
		await settle(() => currentLocale() === "en", "the store must be seeded");
		await settle(
			() =>
				document.querySelectorAll("[data-setting-key=language]").length >= 1,
			"the language row must render on at least one surface",
		);

		const CANON = "setting-effective-language";
		const DIALOG_ID = "setting-effective-language-dialog";
		const count = (id) => document.querySelectorAll(`[id="${id}"]`).length;
		const described = (id, surfaceSelector) => {
			const owner = document.querySelector(surfaceSelector);
			const target = owner?.querySelector(`[aria-describedby~="${id}"]`);
			if (!target)
				return { present: false, resolves: false, insideOwner: false };
			const describedId = target.getAttribute("aria-describedby");
			const el = document.getElementById(describedId);
			return {
				present: true,
				resolves: el !== null,
				insideOwner: Boolean(
					el && owner && owner.contains(el) && el !== target,
				),
			};
		};
		const canon = count(CANON);
		const dialog = count(DIALOG_ID);
		const canonDescribed = described(CANON, "[data-setting-key=language]");
		const dialogDescribed = described(DIALOG_ID, '[role="dialog"]');

		assert.ok(
			canon <= 1 && dialog <= 1,
			`each surface may emit its caption id at most once; saw canon=${canon} dialog=${dialog}`,
		);
		assert.notEqual(
			canon,
			dialog,
			"the two surfaces must not resolve to the same count on one id",
		);
		if (canonDescribed.present)
			assert.ok(
				canonDescribed.resolves && canonDescribed.insideOwner,
				"the General picker must describe a caption inside its own row",
			);
		if (dialogDescribed.present)
			assert.ok(
				dialogDescribed.resolves && dialogDescribed.insideOwner,
				"the dialog picker must describe a caption inside its own dialog",
			);
	},
);
