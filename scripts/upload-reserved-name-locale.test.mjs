/** Real dialog, stable hook fixtures, and its reserved-name issue list. Ordinary
 * publicationIssues prose is a separate literal path, deliberately not claimed.
 * The shell is replaced with a plain container: text/interaction, not pixels.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost",
});
for (const key of [
	"window",
	"document",
	"Element",
	"HTMLElement",
	"HTMLInputElement",
	"Node",
	"MutationObserver",
	"CustomEvent",
	"Event",
	"MouseEvent",
	"DocumentFragment",
	"getComputedStyle",
])
	globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ports = new Map([
	["radient-auth-buttons", "export const RadientAuthButtons = () => null;"],
	[
		"use-memberships-query",
		"export const useMembershipsQuery = () => ({memberships: [], isError: false});",
	],
	[
		"desktop-hooks",
		"export const useDesktopCapabilities = () => ({data: {}}); export const desktopFeatureEnabled = () => false; export const desktopFeatureState = () => 'unsupported'; export const desktopKeys = {};",
	],
	[
		"hub-link-hooks",
		"export const useHubLinks = () => ({data: {links: [], unresolved: []}, isSuccess: true}); export const useHubLinkPolicy = () => ({});",
	],
	[
		"profile-hooks",
		"const profiles = [{name: 'reviewer', source: 'builtin'}]; export const useProfiles = () => ({data: profiles});",
	],
	[
		"use-agent-system-prompt",
		"export const useAgentSystemPrompt = () => ({data: 'Fixture instructions.'});",
	],
	["use-pairing-cause", "export const usePairingCause = () => null;"],
	[
		"use-publish-agent",
		"export const usePublishAgent = () => ({isPending: false});",
	],
	[
		"use-agent-name-availability",
		"export const useAgentNameAvailability = () => ({state: 'idle'});",
	],
	[
		"published-listings-store",
		"export const usePublishedListing = () => null; export const usePublishedListingsStore = {getState: () => ({})};",
	],
	[
		"base-dialog",
		`import {createElement} from 'react'; export const BaseDialog = ({children, footer}) => createElement('section', null, children, footer); export const PrimaryButton = ({children, ...props}) => createElement('button', props, children); export const SecondaryButton = PrimaryButton;`,
	],
]);
const PORT =
	/\/(?:radient-auth-buttons|use-memberships-query|desktop-hooks|hub-link-hooks|profile-hooks|use-agent-system-prompt|use-pairing-cause|use-publish-agent|use-agent-name-availability|published-listings-store|base-dialog)$/;
const ALL = /.*/;
const built = await build({
	stdin: {
		contents: `
		export { UploadAgentDialog } from './src/renderer/src/features/agents/components/upload-agent-dialog';
		export { t, setLocale, registerCatalogue } from './src/i18n';
		export { MemoryRouter } from 'react-router-dom';
		export * as React from 'react';
		export { createRoot } from 'react-dom/client';
	`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: {
		".css": "empty",
		".svg": "empty",
		".png": "empty",
		".webp": "empty",
	},
	plugins: [
		{
			name: "dialog-data-ports",
			setup(builder) {
				builder.onResolve({ filter: PORT }, ({ path }) => ({
					path: path.split("/").at(-1),
					namespace: "port",
				}));
				builder.onLoad({ filter: ALL, namespace: "port" }, ({ path }) => ({
					loader: "js",
					resolveDir: process.cwd(),
					contents: ports.get(path),
				}));
			},
		},
	],
});
const {
	React,
	createRoot,
	MemoryRouter,
	UploadAgentDialog,
	t,
	setLocale,
	registerCatalogue,
} = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
after(() => {
	dom.window.close();
	for (const handle of process._getActiveHandles?.() ?? [])
		if (handle?.constructor?.name === "MessagePort") handle.close();
});

test("reserved-name issue changes locale while dialog and draft stay mounted", async () => {
	registerCatalogue("fr", {
		"ui.agents.publication.name_reserved_builtin.body_same_name":
			"RESERVE-FR {builtin}",
	});
	setLocale("en");
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const agent = {
		id: "synthetic-reserved-agent",
		name: "reviewer",
		description: "Fixture description.",
		tags: [],
	};
	try {
		await React.act(async () =>
			root.render(
				React.createElement(
					MemoryRouter,
					null,
					React.createElement(UploadAgentDialog, {
						open: true,
						onClose() {},
						agent,
						isAuthenticated: true,
					}),
				),
			),
		);
		const issue = () =>
			host.querySelector("ul:not(.text-body) li")?.textContent;
		assert.equal(
			issue(),
			t("ui.agents.publication.name_reserved_builtin.body_same_name", {
				builtin: "reviewer",
			}),
		);
		const input = host.querySelector("input");
		assert.equal(
			input?.value,
			"reviewer",
			"fixture reaches the seeded reserved draft",
		);
		await React.act(async () => setLocale("fr"));
		assert.equal(
			issue(),
			"RESERVE-FR reviewer",
			"memoized reserved-name branch must follow locale",
		);
		assert.strictEqual(
			host.querySelector("input"),
			input,
			"language change must not remount the form",
		);
		assert.equal(input.value, "reviewer");
	} finally {
		await React.act(async () => root.unmount());
		host.remove();
		setLocale("en");
	}
});
