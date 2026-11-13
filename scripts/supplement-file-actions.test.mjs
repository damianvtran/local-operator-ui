import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";

// Real renderer controls and main-process path resolution; only the OS bridge
// is replaced. No Finder, default app, Electron window or live config is touched.
const CHROME_MENU_MODULE = /supplement-file-actions\.tsx$/;
const root = process.cwd();
// Local agent runs supply their session scratchpad; CI has no agent session.
const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir();
const home = mkdtempSync(join(scratch, "supplement-action-"));
const cwd = join(home, "workspace/project");
mkdirSync(join(cwd, "workspace/report"), { recursive: true });
const relative = "workspace/report/RUN-RECORD.md";
const intended = join(cwd, relative);
writeFileSync(intended, "verified synthetic deliverable\n");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
// Node 26 exposes an unconfigured localStorage without a backing file. The
// shipped persisted stores must use this synthetic DOM's storage or a write
// throws between selecting the canvas pane and adding its document.
for (const key of [
	"window",
	"document",
	"localStorage",
	"sessionStorage",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"MutationObserver",
	"MouseEvent",
	"KeyboardEvent",
	"Event",
	"CustomEvent",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const mainBundle = await build({
	entryPoints: ["src/main/directory-listing.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { probeFiles } = await import(
	`data:text/javascript;base64,${Buffer.from(mainBundle.outputFiles[0].text).toString("base64")}`
);
const ROW_MODULE = /supplement-row\.tsx$/;
const bundle = await build({
	mainFields: ["module", "main"],
	conditions: ["import"],
	stdin: {
		contents:
			'export { SupplementRow } from "./src/renderer/src/features/chat/canonical/supplement-row"; export { CanvasPaneProvider } from "./src/renderer/src/features/chat/utils/canvas-pane"; export { useCanvasStore } from "./src/renderer/src/shared/store/canvas-store"; export { toast } from "sonner"; export { setLocale } from "./src/renderer/src/shared/i18n";',
		resolveDir: root,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	plugins: process.env.SUPPLEMENT_CHROME_CONTROL
		? [
				{
					name: "attachment-chrome-baseline-control",
					setup(build) {
						// Same DOM harness with only the changed menu held at the base.
						build.onLoad({ filter: CHROME_MENU_MODULE }, () => ({
							contents: execFileSync(
								"git",
								[
									"show",
									"origin/main:src/renderer/src/features/chat/canonical/supplement-file-actions.tsx",
								],
								{ cwd: root, encoding: "utf8" },
							),
							loader: "tsx",
						}));
					},
				},
			]
		: process.env.SUPPLEMENT_ACTION_CONTROL
			? [
					{
						name: "before-control",
						setup(build) {
							build.onLoad({ filter: ROW_MODULE }, () => ({
								contents: execFileSync(
									"git",
									[
										"show",
										"origin/main:src/renderer/src/features/chat/canonical/supplement-row.tsx",
									],
									{ cwd: root, encoding: "utf8" },
								),
								loader: "tsx",
							}));
						},
					},
				]
			: [],
});
// Keep the ephemeral bundle beside the existing dependencies; never install a
// second tree. This file is removed even if an assertion rejects the control.
const bundlePath = join(
	root,
	"scripts",
	`_supplement-actions-${process.pid}.mjs`,
);
writeFileSync(bundlePath, bundle.outputFiles[0].text);
after(() => {
	dom.window.close();
	rmSync(bundlePath);
	rmSync(home, { recursive: true });
});
const { SupplementRow, CanvasPaneProvider, useCanvasStore, toast, setLocale } =
	await import(bundlePath);
const record = {
	kind: "supplement",
	ts: 1791000060,
	anchor: "a1",
	job: "0123456789ab",
	version: 1,
	state: "done",
	files: [
		{ path: relative, name: "RUN-RECORD.md", kind: "markdown", sizeBytes: 30 },
	],
	filesMore: 0,
	more: [],
	components: [],
	error: "",
	dismissed: false,
	live: false,
};
const click = async (element, type = "click") => {
	assert.ok(element, `missing ${type} target`);
	await act(async () => {
		element.dispatchEvent(
			new dom.window.MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 15));
	});
};

const waitFor = async (predicate) => {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
	}
	assert.ok(predicate(), "action did not settle at its observable destination");
};

test("all three file actions resolve once against session cwd, never process cwd", async () => {
	const previous = process.cwd();
	process.chdir("/");
	const events = [];
	window.api = {
		probeFiles: async (paths, base) => {
			const results = await probeFiles(paths, base, home);
			events.push(["probe-files", paths, base, results[0]?.resolved]);
			return results;
		},
		readFile: async (path) => {
			events.push(["read-file", path]);
			return { success: true, data: readFileSync(path, "utf8") };
		},
		openFile: async (path) => {
			events.push(["open-file", path]);
			return { ok: true };
		},
		showItemInFolder: async (path) => {
			events.push(["show-item-in-folder", path]);
			return { ok: true };
		},
	};
	const host = document.createElement("div");
	document.body.append(host);
	const mounted = createRoot(host);
	try {
		const [before] = await probeFiles([relative], undefined, home);
		assert.equal(before.exists, false);
		console.log(
			"CONTROL process cwd=/ without session:",
			JSON.stringify({ resolved: before.resolved, exists: before.exists }),
		);
		await act(async () =>
			mounted.render(
				h(
					CanvasPaneProvider,
					{ conversationId: "synthetic-highlight-actions" },
					h(SupplementRow, { record, sessionId: "5ea1face0001", cwd }),
				),
			),
		);
		for (const label of [
			"Open in canvas",
			"Open in default app",
			"Reveal in Finder",
		]) {
			const start = events.length;
			await click(
				document.querySelector('[aria-label="Actions for RUN-RECORD.md"]'),
				"pointerdown",
			);
			const menu = [...document.querySelectorAll('[role="menuitem"]')].find(
				(item) => item.textContent.includes(label),
			);
			await click(menu);
			const expectedChannel =
				label === "Open in canvas"
					? "read-file"
					: label === "Open in default app"
						? "open-file"
						: "show-item-in-folder";
			await waitFor(() =>
				events.slice(start).some(([name]) => name === expectedChannel),
			);
			const relativeProbes = events
				.slice(start)
				.filter(
					([name, paths]) => name === "probe-files" && paths[0] === relative,
				);
			assert.equal(
				relativeProbes.length,
				1,
				`${label}: exactly one session-relative resolution`,
			);
			assert.equal(
				relativeProbes[0][2],
				cwd,
				`${label}: session cwd, not process cwd`,
			);
			assert.equal(relativeProbes[0][3], intended);
		}
		// The primary filename button is a separate dispatch branch from the menu.
		const primaryStart = events.length;
		await click(document.querySelector("[data-supplement-file]"));
		await waitFor(() =>
			events
				.slice(primaryStart)
				.some(
					([name, paths]) => name === "probe-files" && paths[0] === relative,
				),
		);
		const primaryProbes = events
			.slice(primaryStart)
			.filter(
				([name, paths]) => name === "probe-files" && paths[0] === relative,
			);
		assert.equal(primaryProbes.length, 1);
		assert.equal(primaryProbes[0][2], cwd);
		assert.equal(primaryProbes[0][3], intended);
		assert.equal(
			events.slice(primaryStart).some(([name]) => name === "open-file"),
			false,
			"primary button selects canvas without OS fallback",
		);
		// Filesystem probes complete independently of React's event dispatch;
		// await their observable destination rather than trusting a fixed sleep.
		for (let attempt = 0; attempt < 100; attempt++) {
			if (
				useCanvasStore.getState().conversations["synthetic-highlight-actions"]
					?.files.length
			)
				break;
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 20));
			});
		}
		const canvas = useCanvasStore.getState();
		assert.ok(
			JSON.stringify(canvas).includes("verified synthetic deliverable"),
			`canvas stores the real synthetic file bytes: ${JSON.stringify({ canvas, events })}`,
		);
		for (const channel of ["read-file", "open-file", "show-item-in-folder"]) {
			const event = events.find(([name]) => name === channel);
			assert.ok(event, `${channel}: ${JSON.stringify(events)}`);
			assert.equal(event[1], intended, JSON.stringify(events));
		}
		const [tilde] = await probeFiles(
			["~/workspace/project/workspace/report/RUN-RECORD.md"],
			cwd,
			home,
		);
		assert.equal(tilde.resolved, intended);
		assert.equal(tilde.exists, true);
		console.log("AFTER renderer bridge:", JSON.stringify(events));
		console.log(
			"TILDE:",
			JSON.stringify({ resolved: tilde.resolved, exists: tilde.exists }),
		);
		// Refused resolution must never hand an unrooted spelling to the OS.
		events.length = 0;
		window.api.probeFiles = async () => {
			throw new Error("synthetic probe failure");
		};
		await click(
			document.querySelector('[aria-label="Actions for RUN-RECORD.md"]'),
			"pointerdown",
		);
		await click(
			[...document.querySelectorAll('[role="menuitem"]')].find((item) =>
				item.textContent.includes("Open in default app"),
			),
		);
		assert.equal(events.length, 0);
		console.log("NEGATIVE probe rejection: no file bridge calls");
		// A fulfilled answer can still be unrooted; it is not a safe action identity.
		let unresolvedProbes = 0;
		window.api.probeFiles = async (paths, base) => {
			assert.deepEqual(paths, [relative]);
			assert.equal(base, cwd);
			unresolvedProbes++;
			return [
				{
					input: relative,
					resolved: relative,
					exists: false,
					isFile: false,
					sizeBytes: null,
					mtimeMs: null,
				},
			];
		};
		await click(
			document.querySelector('[aria-label="Actions for RUN-RECORD.md"]'),
			"pointerdown",
		);
		await click(
			[...document.querySelectorAll('[role="menuitem"]')].find((item) =>
				item.textContent.includes("Open in default app"),
			),
		);
		assert.equal(unresolvedProbes, 1);
		assert.equal(events.length, 0);
		const recoveryToast = toast
			.getHistory()
			.find(
				(entry) =>
					typeof entry.title === "string" &&
					entry.title.includes("Use Copy file path"),
			);
		assert.ok(
			recoveryToast,
			"resolution refusal offers a location-check recovery, not blind retry",
		);
		console.log(
			"NEGATIVE fulfilled unrooted response: one cwd-bound probe, no file action; recovery:",
			recoveryToast.title,
		);
	} finally {
		await act(async () => mounted.unmount());
		host.remove();
		process.chdir(previous);
	}
});

// The "Copy file path" menu item and its "Copied" confirmation reuse the
// audited shared keys. Expected strings come straight from the shipped
// catalogue files (never authored here), so a self-translated or hardcoded
// label cannot pass; the control run (SUPPLEMENT_CHROME_CONTROL=1) bundles the
// base component and must fail this test on its English literals.
const catalogueValue = (locale, file, key) =>
	JSON.parse(
		readFileSync(
			join(root, "src/i18n/catalogues", locale, `${file}.json`),
			"utf8",
		),
	)[key];

for (const locale of ["zh-CN", "fr", "ur", "es", "ru", "hi", "vi"]) {
	test(`copy-file-path item and copied state follow the live locale (${locale})`, async () => {
		const label = catalogueValue(
			locale,
			"ui.common.file_actions",
			"ui.common.file_actions.copy_file_path",
		);
		const copiedLabel = catalogueValue(
			locale,
			"ui.common.actions",
			"ui.common.actions.copied",
		);
		const failure = catalogueValue(
			locale,
			"ui.notices",
			"ui.notices.files.copy_path_failed",
		);
		assert.ok(label && copiedLabel && failure, `${locale}: shipped keys exist`);
		assert.notEqual(label, "Copy file path");
		assert.notEqual(copiedLabel, "Copied");

		const written = [];
		let failWrites = false;
		window.api = {
			probeFiles: (paths, base) => probeFiles(paths, base, home),
		};
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (text) => {
					if (failWrites) throw new Error("synthetic clipboard refusal");
					written.push(text);
				},
			},
		});
		const host = document.createElement("div");
		document.body.append(host);
		const mounted = createRoot(host);
		// The copy item is the menu's last entry in every locale, so locate it
		// positionally rather than by an (English) label.
		// The trigger's aria-label is itself localized, so find it by role, not text.
		const openCopyItem = async () => {
			await click(
				document.querySelector('[aria-haspopup="menu"]'),
				"pointerdown",
			);
			const items = [...document.querySelectorAll('[role="menuitem"]')];
			return items[items.length - 1];
		};
		const closeMenu = async () => {
			await act(async () => {
				document.dispatchEvent(
					new dom.window.KeyboardEvent("keydown", {
						key: "Escape",
						bubbles: true,
					}),
				);
				await new Promise((resolve) => setTimeout(resolve, 15));
			});
		};
		try {
			await act(async () => setLocale("en"));
			await act(async () =>
				mounted.render(
					h(
						CanvasPaneProvider,
						{ conversationId: `synthetic-copy-path-${locale}` },
						h(SupplementRow, { record, sessionId: "5ea1face0001", cwd }),
					),
				),
			);
			let item = await openCopyItem();
			assert.equal(item.textContent, "Copy file path", "en baseline");

			// Live switch while the item is mounted: no remount, no English.
			await act(async () => setLocale(locale));
			item = [...document.querySelectorAll('[role="menuitem"]')].at(-1);
			assert.equal(item.textContent, label);
			assert.ok(!item.textContent.includes("Copy file path"));

			await click(item);
			await waitFor(() => written.length === 1);
			// SupplementRow hands the menu its action path unresolved, so the clipboard
			// receives that spelling byte for byte (behaviour this change preserves).
			assert.deepEqual(written, [relative], "clipboard gets the action path");
			item = await openCopyItem();
			assert.equal(item.textContent, copiedLabel, "copied state localized");
			assert.ok(!item.textContent.includes("Copied"));

			// Locale changes while the copied state is showing relabel it too.
			await act(async () => setLocale("en"));
			assert.equal(
				[...document.querySelectorAll('[role="menuitem"]')].at(-1).textContent,
				"Copied",
			);
			await act(async () => setLocale(locale));
			assert.equal(
				[...document.querySelectorAll('[role="menuitem"]')].at(-1).textContent,
				copiedLabel,
			);

			// A refused clipboard write still raises the already-keyed toast.
			await closeMenu();
			failWrites = true;
			toast.dismiss();
			const failureItem = await openCopyItem();
			await click(failureItem);
			await waitFor(() =>
				toast.getHistory().some((entry) => entry.title === failure),
			);
			console.log(
				`${locale}: label=${label} copied=${copiedLabel} write=${written[0]} failure=${failure}`,
			);
		} finally {
			await act(async () => setLocale("en"));
			await act(async () => mounted.unmount());
			host.remove();
		}
	});
}
