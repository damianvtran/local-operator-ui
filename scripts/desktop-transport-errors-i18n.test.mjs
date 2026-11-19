/**
 * The desktop transport's own failure sentences are catalogue copy (census B8).
 *
 * `desktopRequest` builds three sentences itself - "could not reach the backend
 * process" twice (the IPC rejection and the dev-proxy fetch failure) and "need a
 * compatible backend connection" for a non-2xx dev-proxy answer - and
 * `userFacingMessage` returns a `DesktopControlError.message` verbatim for any
 * error that is not a recognised refusal code. They therefore reached every
 * banner and toast in English whatever the interface language.
 *
 * WHAT THIS RUNS: the real `desktop-api` module with only the OS boundary
 * (`window.api.desktop.request`, `fetch`) stubbed, bundled TOGETHER with the
 * i18n runtime so `setLocale` and the module's `t()` are one instance. Nothing
 * here reads a message to classify an error; the cases assert the class, status,
 * cause and code unchanged beside the sentence.
 *
 * WHAT IT DOES NOT PROVE: a rendered banner (independent browser QA) or the
 * dev-proxy path in a real browser; `fetch` and the IPC bridge are stubs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const DESKTOP_API_SOURCE = /desktop-api\.ts$/;
const API_PATH = "./src/renderer/src/shared/api/local-operator/desktop-api";

/** Bundle the transport (optionally with one source rewritten) with `setLocale`. */
async function loadBundle(rewrite) {
	const bundle = await build({
		stdin: {
			contents: [
				`export * from "${API_PATH}";`,
				'export { setLocale } from "./src/i18n";',
				'export { DESKTOP_FOREGROUND_REQUIRED_CODE, DESKTOP_FOREGROUND_REQUIRED_MESSAGE, DESKTOP_REFUSAL_CODE } from "./src/shared/desktop-contract";',
			].join("\n"),
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["import"],
		write: false,
		plugins: rewrite
			? [
					{
						name: "scratch-rewrite",
						setup(b) {
							b.onLoad({ filter: DESKTOP_API_SOURCE }, () => ({
								contents: rewrite(
									readFileSync(
										`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
										"utf8",
									),
								),
								loader: "ts",
								resolveDir: `${process.cwd()}/src/renderer/src/shared/api/local-operator`,
							}));
						},
					},
				]
			: [],
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${Math.random()}`
	);
}

const LOCALES = ["en", "fr", "ur"];
const catalogue = (locale) =>
	JSON.parse(
		readFileSync(`src/i18n/catalogues/${locale}/ui.common.errors.json`, "utf8"),
	);
const OFFLINE = "ui.common.errors.desktop_backend_offline";
const COMPAT = "ui.common.errors.desktop_backend_compatibility";
const english = catalogue("en");

/** Run `body` with the OS boundary stubbed; always restores the globals. */
async function withBoundary({ ipc, fetchImpl }, body) {
	const saved = { window: globalThis.window, fetch: globalThis.fetch };
	globalThis.window = ipc ? { api: { desktop: { request: ipc } } } : {};
	globalThis.fetch = fetchImpl;
	try {
		return await body();
	} finally {
		globalThis.window = saved.window;
		globalThis.fetch = saved.fetch;
	}
}

const caught = (promise) =>
	promise.then(
		() => assert.fail("expected a rejection"),
		(error) => error,
	);

const SITES = [
	{
		name: "IPC rejection (backend unreachable)",
		key: OFFLINE,
		boundary: (cause) => ({ ipc: () => Promise.reject(cause) }),
		status: null,
		hasCause: true,
	},
	{
		name: "dev-proxy fetch failure (backend unreachable)",
		key: OFFLINE,
		boundary: (cause) => ({ fetchImpl: () => Promise.reject(cause) }),
		status: null,
		hasCause: true,
	},
	{
		name: "non-2xx dev-proxy answer (compatibility)",
		key: COMPAT,
		boundary: () => ({
			fetchImpl: async () => ({ ok: false, status: 404 }),
		}),
		status: 404,
		hasCause: false,
	},
];

test("transport-failure-sentences-en-fr-ur: each site speaks the active locale, structure unchanged", async () => {
	const api = await loadBundle();
	try {
		for (const site of SITES) {
			for (const locale of LOCALES) {
				api.setLocale(locale);
				const cause = new Error("TypeError: fetch failed");
				const error = await withBoundary(site.boundary(cause), () =>
					caught(api.desktopRequest({ op: "config.get" })),
				);
				const want = catalogue(locale)[site.key];
				assert.ok(want, `${locale} ${site.key} exists`);
				// Class, status, cause and code are the transport's facts and
				// must not move with the sentence.
				assert.ok(error instanceof api.DesktopControlError, site.name);
				assert.equal(error.status, site.status, `${site.name} status`);
				assert.equal(error.code, undefined, `${site.name} has no code`);
				if (site.hasCause) assert.equal(error.cause, cause);
				else assert.equal(error.cause, undefined);
				assert.equal(error.message, want, `${site.name} @ ${locale}`);
				// What a surface renders, through the one funnel.
				assert.equal(api.userFacingMessage(error, "fallback"), want);
				if (locale !== "en")
					assert.notEqual(
						want,
						english[site.key],
						`${locale} must not be the English sentence`,
					);
			}
		}
	} finally {
		api.setLocale("en");
	}
});

test("transport-failure-sentences: English text is byte-for-byte what shipped, and switching back works", async () => {
	const api = await loadBundle();
	try {
		api.setLocale("fr");
		api.setLocale("en");
		const offline = await withBoundary(
			{ ipc: () => Promise.reject(new Error("boom")) },
			() => caught(api.desktopRequest({ op: "config.get" })),
		);
		assert.equal(
			offline.message,
			"Desktop controls could not reach the backend process.",
		);
		const compat = await withBoundary(
			{ fetchImpl: async () => ({ ok: false, status: 500 }) },
			() => caught(api.desktopRequest({ op: "config.get" })),
		);
		assert.equal(
			compat.message,
			"Desktop controls need a compatible backend connection.",
		);
		assert.equal(compat.status, 500);
	} finally {
		api.setLocale("en");
	}
});

test("transport-failure-precedence: refusal codes and the foreground refusal still win over the transport sentence", async () => {
	const api = await loadBundle();
	try {
		for (const locale of LOCALES) {
			api.setLocale(locale);
			// 1. Main's foreground refusal is authored copy with its own code and
			// is never reported as an unreachable backend.
			const refusal = await withBoundary(
				{
					ipc: () =>
						Promise.reject(
							new Error(
								`Error invoking remote method 'desktop:request': Error: ${api.DESKTOP_FOREGROUND_REQUIRED_MESSAGE}`,
							),
						),
				},
				() => caught(api.desktopRequest({ op: "config.get" })),
			);
			assert.ok(refusal instanceof api.UserFacingError);
			assert.equal(refusal.code, api.DESKTOP_FOREGROUND_REQUIRED_CODE);
			assert.ok(api.isForegroundRequired(refusal));
			assert.notEqual(refusal.message, catalogue(locale)[OFFLINE]);

			// 2. A recognised refusal code is composed from the code, never from the
			// error's message - even when the message is the transport sentence.
			const code = api.DESKTOP_REFUSAL_CODE.serverUpdating;
			const coded = new api.DesktopControlError(
				503,
				catalogue(locale)[OFFLINE],
				undefined,
				code,
			);
			assert.notEqual(
				api.userFacingMessage(coded, "fallback"),
				catalogue(locale)[OFFLINE],
			);
			assert.equal(coded.code, code);

			// 3. A runtime exception is still not copy: the fallback is used.
			assert.equal(
				api.userFacingMessage(new TypeError("fetch failed"), "fallback"),
				"fallback",
			);
		}
	} finally {
		api.setLocale("en");
	}
});

test("transport-failure-mutation-control: reverting one site to its literal fails the sentence assertion", async () => {
	// A scratch rewrite of the SOURCE (never the worktree): the IPC site goes
	// back to the English literal, so only that site may regress.
	const literal = '"Desktop controls could not reach the backend process."';
	const api = await loadBundle((source) => {
		const first = source.indexOf("desktopBackendOfflineMessage(),");
		assert.ok(first > -1, "the keyed IPC site exists in the source");
		const keyed = "desktopBackendOfflineMessage(),";
		return `${source.slice(0, first)}${literal},${source.slice(first + keyed.length)}`;
	});
	try {
		api.setLocale("fr");
		const ipcSite = await withBoundary(
			{ ipc: () => Promise.reject(new Error("boom")) },
			() => caught(api.desktopRequest({ op: "config.get" })),
		);
		// The mutant speaks English under fr: exactly what the real assertion catches.
		assert.equal(ipcSite.message, english[OFFLINE]);
		assert.notEqual(ipcSite.message, catalogue("fr")[OFFLINE]);
		// ... while the untouched fetch site still localizes, so the control is
		// discriminating per site and not a blanket failure.
		const fetchSite = await withBoundary(
			{ fetchImpl: () => Promise.reject(new Error("boom")) },
			() => caught(api.desktopRequest({ op: "config.get" })),
		);
		assert.equal(fetchSite.message, catalogue("fr")[OFFLINE]);
	} finally {
		api.setLocale("en");
	}
});
