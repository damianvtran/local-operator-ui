import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE API-KEY PANEL, WITH A KEY ALREADY STORED, rendered from the shipped
 * `ProviderDetail`.
 *
 * WHY: the panel showed an EMPTY key field whether or not a key was stored, so a
 * person with a saved ElevenLabs key saw what looked like "no key". A stored key
 * now shows as masked dots in the field's PLACEHOLDER - decoration only: the
 * field's value stays empty, the key is never read back from the daemon (it never
 * leaves its store), and nothing in the DOM can hold it. Saving over it is
 * "Replace key"; "Remove key" (the daemon's `auth.logout`, the same route the
 * row's Sign out uses) asks first. With no key stored the field is empty, as
 * before, and offers "Save key" and nothing to remove.
 *
 * It applies to every API-key provider row: the branch is shared.
 *
 * WHAT IT CANNOT CLAIM: jsdom has no layout engine, so "the dots are drawn" is the
 * placeholder attribute, not pixels.
 */

// React DOM feature-detects input events at import time, so give it a document
// before loading it, and promote the window's own constructors: jsdom's window is
// the DOM, but it is not the global environment the bundled component runs in.
/*
 * The `url` is what gives this document a localStorage: jsdom withholds the whole
 * Storage API from an about:blank one, and the models store persists through it, so
 * a seeded catalogue threw on its first write before any assertion ran.
 */
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// Accessors that refuse to be read out of context; the constructors the
		// components need are plain ones and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
/*
 * Node 22 declares a `localStorage` global that is UNDEFINED without
 * --experimental-webstorage, so the copy loop above skips it -- the key exists in
 * globalThis -- and zustand's persist middleware then reads an undefined storage.
 * The document's own is the one the components expect.
 */
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.sessionStorage = bootstrapDOM.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const ops = [];
const CENSUS = JSON.parse(
	readFileSync("scripts/fixtures/auth-providers-first-run.json", "utf8"),
).providers;
const deepseek = CENSUS.find((row) => row.id === "deepseek");
/** ElevenLabs is not in the first-run census; it is an API-key-only row like DeepSeek. */
const elevenlabs = {
	...deepseek,
	id: "elevenlabs",
	storage_id: "elevenlabs",
	name: "ElevenLabs",
	auth_methods: deepseek.auth_methods.map((method) => ({
		...method,
		id: "elevenlabs",
		method_id: "elevenlabs",
	})),
};
const withKey = (row, stored) => ({
	...row,
	has_credential: stored,
	configured: stored,
	stored_credentials: stored ? 1 : 0,
});
let logoutReply = { status: 200, body: { result: {} } };

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			const ok = (result) => ({ status: 200, body: { result } });
			ops.push({ op: request.op, provider: request.provider });
			switch (request.op) {
				case "capabilities":
					return ok({
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						data: { auth: true, config: true, catalogue: false },
					});
				case "providers.list":
					return ok({ providers: CENSUS });
				case "auth.key":
					return ok({ valid: true });
				case "auth.logout":
					return logoutReply;
				default:
					return ok(null);
			}
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { ProviderDetail } from "./src/renderer/src/features/providers/provider-detail";
			export { resetSignInSessions } from "./src/renderer/src/features/providers/sign-in-sessions";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { voiceKeys } from "./src/renderer/src/features/voice/use-voice-status";
			export { createElement };
		`,
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
	define: { "import.meta.env": "{}" },
	write: false,
});
const bundlePath = new URL("./_provider-key-mask.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	QueryClient,
	QueryClientProvider,
	createElement,
	ProviderDetail,
	resetSignInSessions,
	voiceKeys,
	desktopKeys,
} = await import(bundlePath.href);

/*
 * The process is ended explicitly (a settled panel leaves handles open, as in
 * `provider-detail-remount.test.mjs`), and it carries the code the run earned,
 * so a failing case can never be reported as green.
 */
let failures = 0;
after(() => process.exit(failures > 0 ? 1 : 0));
const check = (name, body) =>
	test(name, async (t) => {
		try {
			await body(t);
		} catch (error) {
			failures += 1;
			throw error;
		}
	});

const SECRET = "test-key-0123456789";

const mount = async (t, provider) => {
	const mounted = {
		client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	};
	t.after(() => {
		try {
			mounted.root?.unmount();
		} finally {
			mounted.container?.remove();
			mounted.client?.clear();
			resetSignInSessions();
		}
	});
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(ProviderDetail, { key: provider.id, provider }),
			),
		);
	});
	ops.length = 0;
	return mounted;
};

const field = (m) => m.container.querySelector("input");
const button = (m, name) =>
	[...m.container.querySelectorAll("button")].find((b) =>
		(b.textContent ?? "").trim().startsWith(name),
	);
const click = (b) =>
	act(async () => {
		b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
const type = async (m, value) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(field(m), value);
		field(m).dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const settle = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
/** Only bullets: a mask, never a word, and never a character of any key. */
const MASK = /^\u2022+$/;

for (const row of [elevenlabs, deepseek]) {
	check(
		`${row.name}: no key stored - an empty field, Save key, nothing to remove`,
		async (t) => {
			const m = await mount(t, withKey(row, false));
			assert.equal(field(m).value, "");
			assert.equal(
				field(m).getAttribute("placeholder"),
				null,
				"no mask without a key",
			);
			assert.ok(button(m, "Save key"));
			assert.equal(button(m, "Replace key"), undefined);
			assert.equal(button(m, "Remove key"), undefined);
		},
	);

	check(
		`${row.name}: a stored key shows masked dots as placeholder only, and Replace and Remove`,
		async (t) => {
			const m = await mount(t, withKey(row, true));
			assert.equal(
				field(m).value,
				"",
				"the value is empty: there is no key to show",
			);
			const mask = field(m).getAttribute("placeholder");
			assert.match(mask ?? "", MASK);
			assert.ok(mask.length >= 8, "long enough to read as a saved key");
			assert.ok(button(m, "Replace key"), "Replace is the save action");
			assert.equal(button(m, "Save key"), undefined);
			assert.ok(button(m, "Remove key"));
			assert.equal(
				button(m, "Replace key").disabled,
				true,
				"nothing typed, nothing to replace",
			);
			assert.ok(
				!m.container.innerHTML.includes(SECRET),
				"no key anywhere in the markup",
			);
		},
	);
}

check(
	"Replace key sends the typed key for this provider, clears the field, and never shows it",
	async (t) => {
		const m = await mount(t, withKey(elevenlabs, true));
		await type(m, SECRET);
		assert.equal(button(m, "Replace key").disabled, false);
		await click(button(m, "Replace key"));
		await settle();
		const sent = ops.filter((o) => o.op === "auth.key");
		assert.deepEqual(sent, [{ op: "auth.key", provider: "elevenlabs" }]);
		assert.ok(!m.container.textContent.includes(SECRET));
		assert.ok(!m.container.innerHTML.includes(SECRET));
	},
);

check(
	"saving or removing a key re-reads the voice status, which says whether the provider is ready",
	async (t) => {
		const m = await mount(t, withKey(elevenlabs, true));
		m.client.setQueryData(voiceKeys.status, { active: null });
		assert.equal(m.client.getQueryState(voiceKeys.status).isInvalidated, false);
		await type(m, SECRET);
		await click(button(m, "Replace key"));
		await settle();
		assert.equal(m.client.getQueryState(voiceKeys.status)?.isInvalidated, true);
		// The save above left its receipt in the per-provider session; start clean.
		resetSignInSessions();
		const n = await mount(t, withKey(elevenlabs, true));
		n.client.setQueryData(voiceKeys.status, { active: null });
		await click(button(n, "Remove key"));
		await click(button(n, "Remove"));
		await settle();
		assert.equal(n.client.getQueryState(voiceKeys.status)?.isInvalidated, true);
	},
);

check(
	"Remove key asks first; Cancel changes nothing; Remove calls auth.logout for that provider",
	async (t) => {
		const m = await mount(t, withKey(elevenlabs, true));
		m.client.setQueryData(desktopKeys.providers, { providers: [] });
		await click(button(m, "Remove key"));
		assert.match(m.container.textContent, /Remove this key\?/);
		assert.equal(
			ops.filter((o) => o.op === "auth.logout").length,
			0,
			"asking sends nothing",
		);
		await click(button(m, "Cancel"));
		assert.ok(button(m, "Remove key"), "back to where it was");
		assert.equal(ops.filter((o) => o.op === "auth.logout").length, 0);
		await click(button(m, "Remove key"));
		await click(button(m, "Remove"));
		await settle();
		assert.deepEqual(
			ops.filter((o) => o.op === "auth.logout"),
			[{ op: "auth.logout", provider: "elevenlabs" }],
		);
		assert.equal(
			m.client.getQueryState(desktopKeys.providers)?.isInvalidated,
			true,
			"the providers are re-read, so the row moves",
		);
	},
);

check("a refused removal says so and keeps the key's controls", async (t) => {
	logoutReply = {
		status: 500,
		body: {
			detail: {
				code: "credential_store_busy",
				message: "The credential store is busy.",
			},
		},
	};
	t.after(() => {
		logoutReply = { status: 200, body: { result: {} } };
	});
	const m = await mount(t, withKey(elevenlabs, true));
	await click(button(m, "Remove key"));
	await click(button(m, "Remove"));
	await settle();
	assert.match(m.container.textContent, /The credential store is busy\./);
	assert.ok(button(m, "Remove key"));
});
