/**
 * "Continue in your own tab" on the passkey notice, as rendered.
 *
 * WHY THIS FILE EXISTS. Password-manager passkey prompts are `chrome-extension://`
 * subframes, which `extensions/subframe-policy.ts` refuses in agent-owned tabs on
 * purpose (CDP must never drive one). An App Store Connect passkey sign-in in an
 * agent's tab therefore ended NotAllowed with only "Open in system browser" on
 * offer, whose session is not shared with the app. The notice now offers the
 * same page in a tab the USER owns - but only on an agent tab's notice: a user
 * tab already runs extension frames, so the button there would promise nothing.
 *
 * `renderToStaticMarkup` drives the shipped component, so the assertions are on
 * the markup a reader gets. Nothing is painted here; frames are the PR's
 * rendered evidence. Main-side gating lives in `passkey-notice.test.mjs` and
 * `browser-host.test.mjs`.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { BrowserPasskeyNotice } from "./src/renderer/src/features/browser/components/browser-passkey-notice";',
			'export { t } from "./src/renderer/src/shared/i18n";',
			'export { renderToStaticMarkup } from "react-dom/server";',
			'export { createElement } from "react";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	// The CJS half of the graph calls `require`, which esbuild's ESM output
	// refuses by default (see agent-picture-edit.test.mjs).
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	// One React shared by the component and the renderer.
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	tsconfig: "tsconfig.app.json",
});

// On disk for the import only: a data: module cannot resolve the bare
// specifiers kept external above.
const bundlePath = new URL(
	`./_passkey-notice-continue-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const { BrowserPasskeyNotice, t, renderToStaticMarkup, createElement } = mod;

const CONTINUE = t("ui.browser.browser_passkey_notice.continue_in_own_tab");
const AGENT_WHY = t("ui.browser.browser_passkey_notice.agent_explanation");
const SYSTEM = t("ui.browser.browser_passkey_notice.open_in_system_browser");

function notice(ownerKind, overrides = {}) {
	return {
		tabId: 39,
		origin: "https://idmsa.apple.com",
		embedded: true,
		kind: "get",
		outcome: "not-allowed",
		at: Date.now(),
		ownerKind,
		suppressed: 0,
		...overrides,
	};
}

function render(props) {
	return renderToStaticMarkup(
		createElement(BrowserPasskeyNotice, {
			onOpen: () => {},
			onDismiss: () => {},
			onContinueInUserTab: () => {},
			...props,
		}),
	);
}

test("an agent tab's notice offers Continue in your own tab, says why, and keeps the system browser", () => {
	const html = render({ notice: notice("agent") });
	assert.ok(html.includes(CONTINUE), "the primary action is offered");
	assert.ok(html.includes('data-tour-tag="browser-passkey-notice-continue"'));
	assert.ok(html.includes(AGENT_WHY), "the agent-tab explanation is shown");
	assert.ok(
		!html.includes(t("ui.browser.browser_passkey_notice.explanation")),
		"one hint, not two",
	);
	assert.ok(html.includes(SYSTEM), "Open in system browser is kept");
	assert.ok(
		html.indexOf(CONTINUE) < html.indexOf(SYSTEM),
		"the user-tab action comes first",
	);
});

test("a user tab's notice never offers it, even when the callback is wired", () => {
	for (const embedded of [false, true]) {
		const html = render({ notice: notice("user", { embedded }) });
		assert.ok(!html.includes(CONTINUE), `embedded=${embedded}`);
		assert.ok(!html.includes(AGENT_WHY), `embedded=${embedded}`);
		assert.ok(html.includes(SYSTEM));
	}
});

test("an agent tab's notice without the callback (an older host) falls back to the old hint", () => {
	const html = render({
		notice: notice("agent"),
		onContinueInUserTab: undefined,
	});
	assert.ok(!html.includes(CONTINUE));
	assert.ok(html.includes(t("ui.browser.browser_passkey_notice.explanation")));
});
