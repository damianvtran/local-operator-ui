import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

/*
 * Q1, round 2 of #1673: source -> search, not a search supplied a hand-built
 * palette row. The real usePaletteItems builds agent rows from useAgents' raw
 * catalogue, then the real searchPalette applies its scope/literal-name rule.
 * Previously the source threw the roster away under `tb`, so the pure search
 * test passed while the actual palette returned nothing.
 *
 * Only input boundaries (catalogue hooks, capabilities, stores and unrelated
 * surfaces) are fixtures. Neither the source assembly nor any search or row
 * builder is replaced. Two raw agents also prove this does not widen `tb` to
 * arbitrary roster matches: `helper` must stay out of `tb helper`.
 */
const inputs = {
	"@shared/i18n/use-locale": "export const useI18nLocale = () => 'en';",
	"@shared/i18n": `export { t } from ${JSON.stringify(`${process.cwd()}/src/i18n/messages.ts`)};`,
	"@shared/hooks/use-agents": `
const data = { total: 2, agents: [
 { id: "tb-helper", name: "tb-helper", tags: [] },
 { id: "helper", name: "helper", tags: [] },
] };
export const useAgents = () => ({ data });`,
	"@shared/api/local-operator/desktop-hooks": `
export const fixture = { bridge: true };
export const useDesktopCapabilities = () => ({ data: { features: {
 team_bridge_conversations: fixture.bridge ? 1 : 0, session_catalogue: 2,
} } });
export const desktopFeatureEnabled = (data, key, version = 1) => (data?.features?.[key] ?? 0) >= version;`,
	"@shared/api/local-operator/profile-hooks":
		"export const useTeams = () => ({ data: [] });",
	"@shared/api/local-operator/session-search": `
export const CHAT_SEARCH_DEBOUNCE_MS = 0;
export const useChatSearch = () => ({});`,
	"@shared/hooks/use-connectivity-status":
		"export const useServerHealth = () => ({});",
	"@shared/hooks/use-debounced-value":
		"export const useDebouncedValue = (value) => value;",
	"@features/mesh/mesh-store":
		"export const useMeshMembership = () => 'unknown';",
	"@features/settings/components/settings-sidebar":
		"export const DEFAULT_SETTINGS_SECTIONS = [];",
	"@features/settings/backend-setting-copy":
		"export const presentSetting = (value) => value;",
	"@shared/store/canonical-sessions-store": `
const state = { sessions: [], forgotten: {}, loading: false, drafts: {}, archiveFacts: {}, fetchSessions: () => {} };
export const useCanonicalSessionsStore = (select) => select(state);
export const LEGACY_CATALOGUE_PAGE = 50;
export const panelSessionIdOfView = () => undefined;
export const unreadMarkKind = () => null;`,
	"@shared/store/ui-preferences-store": `
export const parseConversationRecents = () => [];
export const useUiPreferencesStore = (select) => select({ conversationRecents: [] });`,
	"./use-palette-team-bridge":
		"export const usePaletteTeamBridge = () => ({ destination: null, rows: [] });",
};
const ANY_MODULE = /.*/;
const bundle = await build({
	stdin: {
		contents: `
export { usePaletteItems } from './src/renderer/src/features/command-palette/use-palette-sources';
export { searchPalette } from './src/renderer/src/features/command-palette/palette-search';
export { fixture } from '@shared/api/local-operator/desktop-hooks';
export { QueryClient, QueryClientProvider } from '@tanstack/react-query';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	write: false,
	tsconfig: "tsconfig.app.json",
	plugins: [
		{
			name: "source-input-boundaries",
			setup(b) {
				b.onResolve({ filter: ANY_MODULE }, ({ path }) =>
					Object.hasOwn(inputs, path)
						? { path, namespace: "source-input" }
						: undefined,
				);
				b.onLoad(
					{ filter: ANY_MODULE, namespace: "source-input" },
					({ path }) => ({
						contents: inputs[path],
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
const compiled = new Module(
	`${process.cwd()}/scripts/_palette-source-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/_palette-source-runtime.cjs`;
compiled.paths = createRequire(import.meta.url).resolve.paths("react");
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const {
	usePaletteItems,
	searchPalette,
	fixture,
	QueryClient,
	QueryClientProvider,
} = compiled.exports;

test("Q1: real source hook plus search finds tb-helper with bridge capability on and off", async () => {
	const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>", {
		url: "http://localhost/",
	});
	const previous = { window: globalThis.window, document: globalThis.document };
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(document.getElementById("root"));
	let result;
	function Probe() {
		const sources = usePaletteItems({
			open: true,
			query: "tb helper",
			isOnChatPage: false,
			hasConversation: false,
			isCanvasOpen: false,
		});
		result = {
			sources,
			search: searchPalette({
				items: sources.items,
				raw: "tb helper",
				bridgeScope: sources.bridgeScope,
				chatsAwaiting: sources.chats.awaiting,
			}),
		};
		return null;
	}
	try {
		for (const enabled of [true, false]) {
			fixture.bridge = enabled;
			await act(async () =>
				root.render(
					React.createElement(
						QueryClientProvider,
						{ client },
						React.createElement(Probe),
					),
				),
			);
			assert.equal(result.sources.bridgeScope, enabled);
			assert.equal(result.search.scope, enabled ? "bridge" : null);
			assert.ok(
				result.sources.items.some((item) => item.id === "agent-chat-tb-helper"),
				`capability ${enabled}: source retained the raw roster's tb-helper`,
			);
			const ids = result.search.sections.flatMap((section) =>
				section.items.map(({ item }) => item.id),
			);
			assert.ok(
				ids.includes("agent-chat-tb-helper"),
				`capability ${enabled}: chat row found`,
			);
			assert.ok(
				ids.includes("agent-settings-tb-helper"),
				`capability ${enabled}: settings row found`,
			);
			assert.ok(
				!ids.includes("agent-chat-helper"),
				"an agent sharing only the scoped term stays out",
			);
		}
	} finally {
		await act(async () => root.unmount());
		client.clear();
		dom.window.close();
		Object.assign(globalThis, previous);
	}
});
