/**
 * Where the palette's rows come from.
 *
 * Six sources, each with its own owner, gathered here rather than in the view:
 * the app's destinations, its actions, the settings rail, the backend settings
 * registry, the agent roster, and the conversations. The view knows how to draw
 * a row and what to do when one is run; this module knows what is in the list.
 *
 * ## Why the roster is matched locally and conversations are not
 *
 * The palette used to ask the backend for a name-filtered agent page on every
 * settled keystroke. That is a network round trip per word for a list this
 * machine already holds, so the roster is fetched once and matched locally —
 * text scoring over a hundred rows is microseconds, and the request that used
 * to gate the row is now the request that fills the list.
 *
 * Conversations are the opposite case and keep their request: the answer to
 * "which chat mentioned retention" is not in the renderer at all. That search is
 * the backend's (`sessions.search`), reached through the sidebar's own
 * `useChatSearch` and joined with the sidebar's own `searchChats`, so the two
 * surfaces cannot answer the same query differently — including the case where
 * the backend cannot answer at all, which degrades to title matching in both.
 *
 * ## One request per source, not per keystroke
 *
 * Every hook here is either static, cached by `react-query`, or debounced by the
 * module that owns it. What a keystroke costs is a `useDeferredValue` and a pass
 * over an array; what it never costs is a round trip.
 */

import {
	SESSION_RANK_LABEL,
	matchesLabel,
	searchChats,
} from "@features/chat/chat-search";
import { DEFAULT_SETTINGS_SECTIONS } from "@features/settings/components/settings-sidebar";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	CHAT_SEARCH_DEBOUNCE_MS,
	useChatSearch,
} from "@shared/api/local-operator/session-search";
import { useAgents } from "@shared/hooks/use-agents";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type { SessionSearchHit } from "../../../../shared/desktop-session-contract";
import {
	type PaletteItem,
	buildActionItems,
	buildChatItem,
	buildNavigationItems,
	buildPanelItems,
	buildSettingKeyItems,
	buildSettingsSectionItems,
	parsePaletteQuery,
} from "./palette-search";

/**
 * The agent roster's page size.
 *
 * Large enough that a local match is a match over the whole roster for any
 * realistic install, and a named constant because the number is also the point
 * at which this module stops trusting itself: past it the palette asks the
 * backend to filter the name as well (see `usePaletteItems`), so a roster of
 * five hundred agents is still searchable rather than silently capped.
 */
const AGENT_ROSTER_PAGE = 100;

/** The registry's own cache key; shared with the settings page's section. */
const BACKEND_SETTINGS_KEY = ["desktop", "settings"] as const;

/** The destinations, in the rail's order. Icons are names; the view draws them. */
const PAGES = [
	{
		id: "chat",
		name: "Chat",
		path: "/chat",
		icon: "chat" as const,
		keywords: ["conversations", "messages", "history", "sessions"],
	},
	{
		id: "agents",
		name: "My agents",
		path: "/agents",
		icon: "agents" as const,
		keywords: ["bots", "assistants", "roster", "agent list"],
	},
	{
		id: "agent-hub",
		name: "Agent hub",
		path: "/agent-hub",
		icon: "hub" as const,
		keywords: ["store", "marketplace", "catalog", "discover", "browse agents"],
	},
	{
		id: "schedules",
		name: "Schedules",
		path: "/schedules",
		icon: "schedules" as const,
		keywords: ["cron", "recurring", "automation", "jobs", "timer", "daily"],
	},
	{
		id: "browser",
		name: "Browser",
		path: "/browser",
		icon: "browser" as const,
		keywords: ["web", "sites", "url", "internet"],
	},
	{
		id: "settings",
		name: "Settings",
		path: "/settings",
		icon: "settings" as const,
		keywords: ["preferences", "config", "options", "configuration"],
	},
];

export type PaletteChatState = {
	/** A query is out and its answer has not landed yet. */
	awaiting: boolean;
	/** The negotiated backend cannot search conversations at all. */
	unavailable: boolean;
	/**
	 * WHICH "cannot": the capability could not be read at all, rather than being
	 * read and found absent.
	 *
	 * The two reach the same `unavailable`, and they need different sentences: a
	 * backend that is unreachable will not start searching conversations because
	 * the user updated the app, and telling them to is a remedy that cannot work
	 * (design round 1, D2). `capabilities.isSuccess` is the distinction, and it is
	 * the same read the gate itself is built from.
	 */
	unreachable: boolean;
	/**
	 * The query is longer than the store's search accepts, so no request was
	 * made. Carried rather than swallowed: a search box that silently stops
	 * searching is worse than one that says why it cannot.
	 */
	overLong: boolean;
	/**
	 * The capability read is still in flight, so NOTHING is known yet — not
	 * "unavailable", and not "available" either. The view says nothing about
	 * the search state while this is true rather than picking a sentence that
	 * will be wrong in one of the two cases.
	 */
	pending: boolean;
};

export type PaletteSources = {
	items: PaletteItem[];
	chats: PaletteChatState;
};

export type PaletteSourceInput = {
	/** Whether the palette is open; every source is gated on it. */
	open: boolean;
	/** The DEFERRED query the view is drawing. */
	query: string;
	isOnChatPage: boolean;
	hasConversation: boolean;
	isCanvasOpen: boolean;
};
/**
 * Assemble the palette's rows for a query.
 *
 * The parse decides which sources are asked at all, which is what keeps a `#`
 * query from spending the settings and agent sources on an answer they cannot
 * give — and, for conversations, from spending a store scan on one.
 */
export function usePaletteItems({
	open,
	query,
	isOnChatPage,
	hasConversation,
	isCanvasOpen,
}: PaletteSourceInput): PaletteSources {
	const { scope, terms } = parsePaletteQuery(query);
	const wantsChats = scope === null || scope === "chat";
	const wantsAgents = scope === null || scope === "agent";
	const wantsSettings = scope === null || scope === "setting";

	const capabilities = useDesktopCapabilities();
	const chatSearchSupported = desktopFeatureEnabled(
		capabilities.data,
		"session_search",
	);
	const settingsSupported = desktopFeatureEnabled(
		capabilities.data,
		"settings",
	);
	/*
	 * The same gate the sidebar's own "New chat" button carries, read from the
	 * same capability at the same version rather than from a second opinion: a
	 * draft staged against a backend that cannot create sessions is a row the
	 * palette would have offered and could not deliver.
	 */
	const canStageDraft = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
	);

	/* ---------------------------- conversations ---------------------------- */

	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const sessionsLoading = useCanonicalSessionsStore((state) => state.loading);
	const fetchSessions = useCanonicalSessionsStore(
		(state) => state.fetchSessions,
	);

	/*
	 * The catalogue, when this route never asked for it.
	 *
	 * The chat route's own sidebar keeps the store warm, but the palette opens
	 * anywhere — and its browse list offers recent conversations as soon as any
	 * exist. ONE request per open, and the ref is what makes that true: gating on
	 * `sessions.length` and `loading` alone re-armed the moment a failed fetch
	 * cleared `loading`, so a backend that was down produced an endless
	 * fetch-fail-fetch cycle, and every iteration re-rendered this palette (which
	 * is how it was found: hundreds of console lines from the agent roster's own
	 * effect in the space of 20ms, and a renderer too busy to answer CDP).
	 *
	 * One attempt per open is also the honest shape of the request: a driver run
	 * with no backend must not spin, and a user who opens the palette again has
	 * asked again.
	 */
	const catalogueAsked = useRef(false);
	useEffect(() => {
		if (!open) {
			catalogueAsked.current = false;
			return;
		}
		if (catalogueAsked.current || sessions.length > 0 || sessionsLoading)
			return;
		catalogueAsked.current = true;
		void fetchSessions();
	}, [open, sessions.length, sessionsLoading, fetchSessions]);

	/*
	 * Asked with the TERMS, not the raw query: `#theme` must search the store for
	 * "theme" and not for "#theme". An empty term list asks nothing at all — the
	 * browse state's featured rows already answer without a scan — and a scope
	 * that excludes chats asks nothing either, which is the whole point of a
	 * scope.
	 */
	const search = useChatSearch(
		terms,
		open && wantsChats && terms.length > 0 && chatSearchSupported,
	);
	/*
	 * Used only when it is the answer to the question in hand. Requests complete
	 * out of order, so the response's echoed query is the only thing that says
	 * which question a set of hits answers — the rule the sidebar settled on, and
	 * the reason a stale answer cannot put rows in this list that the query would
	 * not return.
	 */
	const hits: SessionSearchHit[] | null =
		search.data && search.data.query === terms ? search.data.sessions : null;

	const chatItems = useMemo(() => {
		if (!wantsChats) return [];
		const { rows } = searchChats(sessions, terms, hits);
		const byId = new Map((hits ?? []).map((hit) => [hit.id, hit]));
		return rows.map((row, index) => {
			const hit = byId.get(row.session_id);
			const labelMatch = matchesLabel(row, terms);
			const item = buildChatItem(row);
			/*
			 * The marker says why the row is on screen. A row whose own title
			 * contains the query is already explained by what is on screen, so it
			 * gets no marker — the same rule `searchChats` applies before it sets
			 * `body_match`, and the same one the sidebar renders.
			 */
			const marked = Boolean(hit?.body_match) && !labelMatch;
			return {
				...item,
				hint: marked ? "In conversation" : item.hint,
				/*
				 * The backend's tier, which is what makes the store's answer ORDER
				 * the list: a conversation the store knows by content outranks one
				 * whose title merely contains the letters.
				 *
				 * `Math.min` and not `??`, because the two readings are PEERS and the
				 * better one is the row's: a local label hit is the same tier as a
				 * backend name hit, so a row the backend placed at tier 3 whose title
				 * matches exactly keeps tier 1 here - exactly what the sidebar's own
				 * join does (`chat-search.ts`). Preferring the backend's number dimmed
				 * a row in the palette that the sidebar highlighted, for the same
				 * query and the same conversation (round 1, R-2).
				 */
				/*
				 * No name tier at all when neither reading matched, rather than the
				 * label tier by default: the join never admits such a row, so this only
				 * keeps the claim honest for a browse-state row that is scored on nothing
				 * (round 2, R2-2).
				 */
				tier:
					labelMatch || hit
						? Math.min(
								hit?.rank ?? SESSION_RANK_LABEL,
								labelMatch ? SESSION_RANK_LABEL : Number.POSITIVE_INFINITY,
							)
						: undefined,
				/*
				 * The catalogue's own preview is context, not a name: a row that matched
				 * only inside it belongs in the list, at the bottom of its group, which is
				 * the `soft` weight rather than the keyword one.
				 */
				soft: row.preview ?? undefined,
				order: index,
				featured: terms.length === 0,
			} satisfies PaletteItem;
		});
	}, [sessions, terms, hits, wantsChats]);

	/* -------------------------------- agents -------------------------------- */

	const roster = useAgents(1, AGENT_ROSTER_PAGE);

	/*
	 * The roster's own honesty check. `total` counts every agent the backend
	 * holds; anything past the loaded page is invisible to a local match, so when
	 * the two disagree the palette asks the backend to filter the name as well
	 * and merges the answer. This is a fallback for a roster larger than one page
	 * rather than the normal path: in the ordinary case this hook is the same
	 * cached query as the one above, keyed identically, and costs nothing.
	 */
	const debouncedTerms = useDebouncedValue(terms, CHAT_SEARCH_DEBOUNCE_MS);
	const rosterTruncated =
		(roster.data?.total ?? 0) > (roster.data?.agents?.length ?? 0);
	const nameFiltered = useAgents(
		1,
		AGENT_ROSTER_PAGE,
		0,
		rosterTruncated && wantsAgents && debouncedTerms
			? debouncedTerms
			: undefined,
	);

	const agentItems = useMemo(() => {
		if (!wantsAgents) return [];
		const seen = new Set<string>();
		const agents: { id: string; name: string; tags?: string[] }[] = [];
		for (const list of [roster.data?.agents, nameFiltered.data?.agents]) {
			for (const agent of list ?? []) {
				if (seen.has(agent.id)) continue;
				seen.add(agent.id);
				agents.push(agent);
			}
		}
		/*
		 * Two rows per agent, and they have to be told apart: the roster shows the
		 * same name twice and the only other difference is a 16px glyph. The hint
		 * is part of the match too, which is what makes "ada settings" land on the
		 * right one of the pair.
		 */
		const items: PaletteItem[] = [];
		for (const agent of agents) {
			items.push({
				id: `agent-chat-${agent.id}`,
				kind: "agent",
				group: "agents",
				name: agent.name,
				hint: "Open chat",
				icon: "chat",
				keywords: agent.tags,
				target: { type: "path", path: `/chat/${agent.id}` },
				/*
				 * In the browse list only the chat row is offered: five agents as ten
				 * rows is a wall, and the settings row is what a search for the agent
				 * BY NAME turns up, which is a search rather than a browse.
				 */
				featured: terms.length === 0,
			});
			items.push({
				id: `agent-settings-${agent.id}`,
				kind: "agent",
				group: "agents",
				name: agent.name,
				hint: "Agent settings",
				icon: "settings",
				keywords: agent.tags,
				target: { type: "path", path: `/agents/${agent.id}` },
			});
		}
		// Definition order is the backend's own (newest first), which is the order
		// a browse list wants and a stable tie-break a search can rely on.
		return items.map((item, index) => ({ ...item, order: index }));
	}, [roster.data, nameFiltered.data, terms.length, wantsAgents]);

	/* ------------------------------- settings ------------------------------- */

	const registry = useQuery({
		queryKey: BACKEND_SETTINGS_KEY,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: open && wantsSettings && settingsSupported,
		staleTime: 10_000,
	});

	const settingItems = useMemo(() => {
		if (!wantsSettings) return [];
		return [
			...buildSettingsSectionItems(DEFAULT_SETTINGS_SECTIONS),
			...buildSettingKeyItems(registry.data?.settings ?? []),
		];
	}, [registry.data, wantsSettings]);

	/* ------------------------------ panels ------------------------------ */

	/*
	 * The slash-command panels, as rows.
	 *
	 * These are the destinations the composer's slash menu already reaches
	 * (`/info`, `/usage`, `/analytics`, `/session`), and the palette is a second
	 * door to the same room: the row names a destination and the chat pane
	 * presents it (`chat-panel-request-store.ts`), so there is one implementation
	 * of each panel and one idea of what a destination means.
	 *
	 * The gate is whether the pane can present ANYTHING, which is the rule this
	 * palette holds every row to, and it is the pane's own state rather than a proxy
	 * for it: the pane exists when the catalogue capability is live and the route
	 * resolves to a session or a draft, and with the backend down the chat route
	 * paints "Connecting to the backend..." where the pane would be. A panel row
	 * there would close the palette and open nothing - a driver run with no backend
	 * found exactly that, which is why the gate is here rather than on which panel
	 * would have something to say.
	 *
	 * Inside that, `Session` and `Analytics` additionally need a real conversation:
	 * `session.diagnostics` on a draft would report on a session that does not exist
	 * yet, and Analytics' "this session" scope would have nothing to scope to.
	 */
	const activeSessionId = useCanonicalSessionsStore(
		(state) => state.activeSessionId,
	);
	const activeDraftKey = useCanonicalSessionsStore(
		(state) => state.activeDraftKey,
	);
	/*
	 * Whether the chat pane can present a panel AT ALL, which is not the same
	 * question as whether the panel would have something to say.
	 *
	 * Every panel is presented by the pane (`SessionPanel`, which owns the
	 * presentation slot), and the pane only exists when the catalogue capability is
	 * live and the route resolves to a session or a draft. With the backend down the
	 * chat route paints "Connecting to the backend..." instead, so a panel row there
	 * would close the palette and do nothing - the dead control this palette refuses
	 * to offer, and the exact defect a driver run with no backend found.
	 *
	 * `canStageDraft` is that same capability, read at the same version the chat
	 * route and the sidebar read it, rather than a second opinion about it.
	 */
	const paneCanPresent =
		canStageDraft && Boolean(activeSessionId ?? activeDraftKey);
	/*
	 * A conversation reading needs a conversation: `/session` on a draft would
	 * report on a session that does not exist yet, and Analytics' "this session"
	 * scope would have nothing to scope to.
	 */
	const sessionPanelsAvailable = Boolean(activeSessionId);

	const panelItems = useMemo(() => {
		if (!paneCanPresent) return [];
		return buildPanelItems([
			{
				id: "info",
				destination: "info",
				name: "Info",
				hint: "App, backend and environment",
				icon: "info",
				keywords: [
					"about",
					"version",
					"environment",
					"diagnostics",
					"host",
					"runtime",
				],
			},
			{
				id: "usage",
				destination: "usage",
				name: "Provider usage",
				hint: "Credits, limits and spend",
				icon: "usage",
				keywords: [
					"usage",
					"credits",
					"billing",
					"limits",
					"cost",
					"spend",
					"tokens",
					"quota",
				],
			},
			...(sessionPanelsAvailable
				? [
						{
							id: "session",
							destination: "session.diagnostics",
							name: "Session",
							hint: "Diagnostics for this conversation",
							icon: "session" as const,
							keywords: [
								"diagnostics",
								"report",
								"tokens",
								"context",
								"timings",
								"tool calls",
							],
						},
						{
							id: "analytics",
							destination: "analytics",
							name: "Analytics",
							hint: "Usage over time",
							icon: "analytics" as const,
							keywords: [
								"usage",
								"charts",
								"trends",
								"cost",
								"spend",
								"tokens",
								"reports",
							],
						},
					]
				: []),
		]);
	}, [paneCanPresent, sessionPanelsAvailable]);

	/* ------------------------ destinations and actions ---------------------- */

	const items = useMemo(
		() => [
			...buildNavigationItems(PAGES),
			...buildActionItems(
				buildPaletteActions({
					isOnChatPage,
					hasConversation,
					isCanvasOpen,
					canStageDraft,
				}),
			),
			...panelItems,
			...settingItems,
			...agentItems,
			...chatItems,
		],
		[
			isOnChatPage,
			hasConversation,
			isCanvasOpen,
			canStageDraft,
			panelItems,
			settingItems,
			agentItems,
			chatItems,
		],
	);

	return {
		items,
		chats: {
			/*
			 * Every term of this is a state the panel has to be able to explain:
			 * a request in flight is not an empty answer, a backend that cannot
			 * search is not a search that found nothing, and a query the store
			 * refuses is neither.
			 */
			awaiting:
				open &&
				wantsChats &&
				terms.length > 0 &&
				chatSearchSupported &&
				!search.refused &&
				!search.isError &&
				search.data?.query !== terms,
			unavailable: wantsChats && terms.length > 0 && !chatSearchSupported,
			/*
			 * `isError`, not `!isSuccess`: the query is also "not successful" while it is
			 * still PENDING, and calling a healthy backend unreachable during startup is
			 * the same class of misstatement the two sentences exist to avoid (round 2,
			 * R2-3). `pending` is what the view uses to say nothing at all in that window.
			 */
			unreachable: capabilities.isError,
			pending: capabilities.isLoading || capabilities.isPending,
			overLong: search.refused,
		},
	};
}

/**
 * The actions, with the three that depend on where the user is.
 *
 * `New chat` stages a draft exactly the way the sidebar's own button does, so
 * the palette is a second door to the same room rather than a second
 * implementation of one. `Clear conversation` and the canvas toggle are offered
 * only where they mean something: a palette that lists an action it cannot
 * perform is worse than one that omits it.
 */
function buildPaletteActions({
	isOnChatPage,
	hasConversation,
	isCanvasOpen,
	canStageDraft,
}: {
	isOnChatPage: boolean;
	hasConversation: boolean;
	isCanvasOpen: boolean;
	canStageDraft: boolean;
}) {
	return [
		...(canStageDraft
			? [
					{
						id: "new-chat",
						name: "New chat",
						icon: "new-chat" as const,
						keywords: ["start chat", "compose", "draft", "new conversation"],
						verb: "Start",
						command: "new-chat" as const,
						featured: true,
					},
				]
			: []),
		{
			id: "create-agent",
			name: "Create agent",
			icon: "plus" as const,
			keywords: ["new agent", "add agent", "make agent"],
			verb: "Create",
			command: "create-agent" as const,
			featured: true,
		},
		...(isOnChatPage
			? [
					{
						id: "toggle-canvas",
						name: isCanvasOpen ? "Close canvas" : "Open canvas",
						icon: isCanvasOpen
							? ("canvas-close" as const)
							: ("canvas-open" as const),
						keywords: ["files", "workspace", "panel", "editor", "artifacts"],
						verb: isCanvasOpen ? "Close" : "Open",
						command: "toggle-canvas" as const,
						featured: true,
					},
				]
			: []),
		...(isOnChatPage && hasConversation
			? [
					{
						id: "clear-conversation",
						name: "Clear conversation",
						icon: "trash" as const,
						keywords: [
							"delete chat",
							"reset",
							"wipe",
							"erase",
							"clear history",
						],
						verb: "Clear",
						command: "clear-conversation" as const,
						destructive: true,
						featured: true,
					},
				]
			: []),
	];
}
