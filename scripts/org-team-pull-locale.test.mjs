/** Mount the real roster, fail a Pull through its hook port, then change locale.
 * The outer subscriber models the hub page: parent repaint alone must not keep
 * the memoized treatment in English. No layout or live hub coverage is claimed.
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
	"Node",
	"MutationObserver",
	"CustomEvent",
	"Event",
	"MouseEvent",
])
	globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const HOOK = /\/use-(?:org-teams-query|team-pull-mutation)$/;
const ALL = /.*/;
globalThis.__orgLocaleTeam = {
	id: "synthetic-team",
	name: "test-team",
	members: [],
	manager: null,
	description: "fixture",
};
const built = await build({
	stdin: {
		contents: `
		export { OrgTeamsList } from './src/renderer/src/features/agent-hub/components/org-teams-list';
		export { PublicationError } from './src/renderer/src/shared/api/local-operator/publication-errors';
		export { publicationTreatment } from './src/renderer/src/features/agents/utils/publication-failure';
		export { useI18nLocale } from './src/renderer/src/shared/i18n/use-locale';
		export { t, setLocale, registerCatalogue } from './src/i18n';
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
			name: "roster-query-ports",
			setup(builder) {
				builder.onResolve({ filter: HOOK }, ({ path }) => ({
					path,
					namespace: "port",
				}));
				builder.onLoad({ filter: ALL, namespace: "port" }, ({ path }) => ({
					loader: "js",
					resolveDir: process.cwd(),
					contents: path.endsWith("use-org-teams-query")
						? "const teams = [globalThis.__orgLocaleTeam]; export const useOrgTeamsQuery = () => ({teams, isLoading: false, isFetching: false, isError: false, refetch() {}});"
						: `import {useState} from 'react'; export function useTeamPullMutation() { const [error, setError] = useState(null); return {error, isPending: false, mutate(_variables, callbacks) {setError(globalThis.__orgLocaleError); callbacks.onError(); callbacks.onSettled();}}; }`,
				}));
			},
		},
	],
});
const {
	React,
	createRoot,
	OrgTeamsList,
	PublicationError,
	useI18nLocale,
	t,
	setLocale,
	registerCatalogue,
} = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
after(() => {
	dom.window.close();
	globalThis.__orgLocaleTeam = undefined;
	globalThis.__orgLocaleError = undefined;
	for (const handle of process._getActiveHandles?.() ?? [])
		if (handle?.constructor?.name === "MessagePort") handle.close();
});

test("coded team-pull refusal changes language after parent locale repaint", async () => {
	registerCatalogue("fr", {
		"ui.agents.publication.team_not_found.body": "EQUIPE-ABSENTE-FR",
	});
	setLocale("en");
	globalThis.__orgLocaleError = new PublicationError(
		404,
		"team_not_found",
		"opaque backend message",
	);
	function Parent() {
		useI18nLocale();
		return React.createElement(OrgTeamsList, {
			tenantId: "synthetic-tenant",
			orgName: "Fixture",
		});
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await React.act(async () => root.render(React.createElement(Parent)));
		const pull = host.querySelector("button[aria-label]");
		assert.ok(pull, "fixture reaches Pull");
		await React.act(async () => pull.click());
		const output = () =>
			host.querySelector('[data-testid="org-team-pull-error"] output')
				?.textContent;
		assert.equal(output(), t("ui.agents.publication.team_not_found.body"));
		await React.act(async () => setLocale("fr"));
		assert.equal(
			output(),
			"EQUIPE-ABSENTE-FR",
			"memoized refusal must follow locale, not merely its child labels",
		);
	} finally {
		await React.act(async () => root.unmount());
		host.remove();
		setLocale("en");
	}
});
