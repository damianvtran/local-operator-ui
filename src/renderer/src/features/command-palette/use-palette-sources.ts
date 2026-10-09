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
import type { ArchiveView } from "@features/chat/chat-search";
import { useMeshMembership } from "@features/mesh/mesh-store";
import { DEFAULT_SETTINGS_SECTIONS } from "@features/settings/components/settings-sidebar";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useTeams } from "@shared/api/local-operator/profile-hooks";
import {
	CHAT_SEARCH_DEBOUNCE_MS,
	useChatSearch,
} from "@shared/api/local-operator/session-search";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import { useAgents } from "@shared/hooks/use-agents";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import {
	LEGACY_CATALOGUE_PAGE,
	panelSessionIdOfView,
	unreadMarkKind,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	parseConversationRecents,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type { SessionSearchHit } from "../../../../shared/desktop-session-contract";
import {
	type PaletteCatalogueState,
	type PaletteItem,
	buildActionItems,
	buildChatItem,
	buildNavigationItems,
	buildPanelItems,
	buildSettingKeyItems,
	buildSettingsSectionItems,
	parsePaletteQuery,
} from "./palette-search";
import { chatRecentsOfRow } from "./use-conversation-recents";

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
		id: "projects",
		name: "Projects",
		path: "/projects",
		icon: "projects" as const,
		keywords: ["workstreams", "milestones", "tracking", "planning"],
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

/**
 * The Mesh destination, and it is NOT in `PAGES` above because it is the one row whose
 * presence depends on a fact `PAGES` cannot read: membership (review round 1, R1-3).
 *
 * `PAGES` is "the destinations, in the rail's order", so a rail item the palette cannot
 * offer makes the palette's own list stop being the rail's; and a rail item the palette
 * offers when the rail has none is the same defect the other way. Both therefore read
 * `useMeshMembership`, whose long comment states why the capability alone is not enough.
 */
const MESH_PAGE = {
	id: "mesh",
	name: "Mesh",
	path: "/mesh",
	icon: "network" as const,
	keywords: ["networks", "peers", "devices", "relay", "mesh"],
};

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
	/**
	 * What the BROWSE list's catalogue is doing (chats scope, no terms typed).
	 *
	 * A different question from the ones above, which are all about the
	 * SEARCH: with no terms, the chats section is what the local store holds,
	 * and the panel must be able to say "still loading" without flashing "no
	 * conversations" at a user whose store simply has not answered yet
	 * (design round 2, D2). Never-asked (`catalogueAsked` false) is folded
	 * into loading: the fetch effect fires the moment the palette opens, so
	 * the first painted frame is a frame of a request about to be in flight,
	 * and the loading sentence is the only one true across both.
	 */
	catalogue: PaletteCatalogueState;
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
	/*
	 * Teams ride the SAME scope the roster does (issue #849): `@` reads "the things
	 * I can start a chat with", and a team is one of them. A name of its own rather
	 * than a reuse of `wantsAgents` because the two rows come from two catalogues
	 * with two gates; the scope each reads is the identical expression, which is
	 * what keeps them together when the scope table changes.
	 */
	const wantsTeams = scope === null || scope === "agent";
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
	/*
	 * The archive capability, the same gate the sidebar's own list reads
	 * (`chat-sidebar.tsx`'s `archiveEnabled`), so the palette's chat rows carry the
	 * SAME archive fact the sidebar's membership filter uses. `use-palette-sources`
	 * derives the fact for the Recents pin only (`chatRecentsOfRow`, below, over the
	 * answered `archiveFacts` as well as the row); the
	 * palette's browse pool keeps offering archived rows, which is pre-existing and
	 * out of this change's scope.
	 */
	const archiveEnabled = desktopFeatureEnabled(
		capabilities.data,
		"session_archive",
	);
	/*
	 * The team catalogue, for the CHAT ROWS' hint labels AND for the palette's own
	 * team rows (issue #849). Widened from `wantsChats` to the roster scope so the
	 * `@` view can draw teams: before this the call was made only to resolve a
	 * binding's slug to its label, and a `@team` query would have had nothing to
	 * draw. The gate is the sidebar's own (`team_catalogue`), so the two surfaces
	 * agree about which teams exist.
	 *
	 * Absent (gate off, list still landing), the map is empty and the slug remains
	 * the string, which is the pre-labels pixel; the rows simply do not appear.
	 */
	const teamNames = useTeams(
		(wantsChats || wantsTeams) &&
			desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	const teamLabels = useMemo(
		() =>
			new Map(
				(teamNames.data ?? []).map((row) => [row.name, teamDisplayName(row)]),
			),
		[teamNames.data],
	);
	/*
	/*
	 * The rail's Mesh row, by the SAME rule the rail uses - membership, not the
	 * capability - so the palette's destination SET stays the rail's set (R1-3). The row
	 * is appended after `PAGES`, which keeps this file's single ordering rule for the rows
	 * `PAGES` owns; the mesh row's own position in the rail is the tab's business, not
	 * this list's, and a reader comparing the two sees the same set either way.
	 */
	const meshMembership = useMeshMembership(
		desktopFeatureEnabled(capabilities.data, "peers"),
	);
	/*
	 * The Projects entry is offered only on a backend that serves the surface - the same
	 * predicate the sidebar row and the route's own gate read, so the three surfaces cannot
	 * disagree. Absent means the entry is not built at all, which is what keeps an older
	 * backend's palette byte-identical to the one this app shipped before Projects.
	 */
	const projectsEnabled = desktopFeatureEnabled(
		capabilities.data,
		"projects",
		1,
	);
	const pages = useMemo(
		() => [
			...PAGES.filter((page) => page.id !== "projects" || projectsEnabled),
			...(meshMembership === "member" ? [MESH_PAGE] : []),
		],
		[meshMembership, projectsEnabled],
	);
	/*
	 * Whether MAIN has an answer about the credential, which is a different fact
	 * from the capability above.
	 *
	 * `/v1/capabilities` is an UNAUTHENTICATED route: a daemon this app cannot
	 * authenticate to still answers it, and answers with its own
	 * `desktop_available: true`, so `canStageDraft` is satisfied by an origin every
	 * other op of ours is refused at (QA round 1, Q-1). Main is the process that
	 * knows - it claims the plane and holds the bearer - and it publishes the
	 * PAIRING record (`shared/backend-status.ts`, `DaemonStatusSnapshot.pairing`),
	 * which is read here rather than the `desktopAvailable` boolean that used to sit
	 * beside it: that boolean was written `true` at every attach and `false` nowhere,
	 * so it could not report a pairing a successor had destroyed (design § 1.4,
	 * § 5.2).
	 *
	 * ONLY AN ESTABLISHED CAUSE CLOSES THE GATE. `undefined` is a host with no main to
	 * ask (Storybook, the browser dev server) or an answer still in flight, and turning
	 * "nobody has answered" into "the backend refused you" would be the second
	 * opinion this palette keeps refusing to hold — on a host with no bridge there
	 * is no desktop transport at all, so there is nothing to mislead.
	 */
	const { data: serverHealth } = useServerHealth();
	const desktopPlaneRefused =
		serverHealth?.snapshot?.pairing.available === false;

	/* ---------------------------- conversations ---------------------------- */

	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	/*
	 * THE PALETTE'S OWN VIEW OF WHAT MAY NOT BE DRAWN (agent review round 2, R2-2).
	 *
	 * `searchChats` needs the tombstones and the archive widening, and this call
	 * site used to hand it neither: a hit this client no longer lists, for a
	 * conversation this window permanently deleted, was rebuilt into a synthesized
	 * row - clickable, and opening onto the deleted conversation's notice - while
	 * this module's own docstring promises the palette shows "the same rows the
	 * sidebar would". The hits come from the same `useChatSearch` cache the sidebar
	 * reads (same 30 s key), so the window in which the two disagree is exactly the
	 * one the tombstone exists to close.
	 *
	 * Read the same two fields the sidebar reads, for the same reason: the sidebar
	 * passes `archiveView` (`chat-sidebar.tsx`), and a second join with a different
	 * view is how the two surfaces drift apart.
	 */
	const forgotten = useCanonicalSessionsStore((state) => state.forgotten);
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
		/*
		 * THE SET, EXPLICITLY (round 3, Q-1). This read is the palette's browse rows and
		 * the only consumer of a row's `preview`, so it asks for the WHOLE catalogue by
		 * name - the unnamed default is now the head page on a daemon that advertises
		 * paging, and a palette whose browse silently dropped to 50 rows would be a
		 * regression this change introduced. The guard above means a normal session already
		 * holds rows and never fires this at all.
		 */
		void fetchSessions(LEGACY_CATALOGUE_PAGE);
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

	const archiveView = useMemo<ArchiveView>(
		() => ({
			/*
			 * The palette asks its own search and does not widen it, so an archived
			 * conversation is not in a palette SEARCH answer. IT IS IN THE BROWSE
			 * POOL: an empty query returns the catalogue rows as they came (this
			 * module's join is the sidebar's, and `searchChats`'s empty-query arm
			 * applies no archive filter), so the `#` switcher's browse list has always
			 * offered archived conversations - the base tree draws them under Chats.
			 * That is pre-existing on both trees (QA round 1, Q-1 measured it) and out
			 * of this change's scope; what this change does is stop the Recents pin
			 * from CLAIMING one (`palette-search.ts`, on the row's `archived` fact).
			 * THE SIDEBAR IS NOT ALWAYS NARROWER THAN THIS, which is the correction
			 * agent review round 3 (N3) asked for: with `chat-search.tsx`'s `Include
			 * archived` toggle ON and a query typed, the sidebar lists the archived
			 * conversation the palette's search will not, so the two DO disagree for as
			 * long as the toggle is on. That is a deliberate scope difference - the
			 * palette has no toggle and offering archived rows in it, with no control
			 * saying so, would be the silent widening the brief forbids - but the
			 * earlier sentence here ("a scope that offered archived conversations would
			 * have to say so") read as though the palette could never be the narrower
			 * of the two, and the sentence it replaced read as though an archived row
			 * could never be in a palette list at all. The honest statement is that
			 * this view declares its own scope - for the SEARCH - rather than
			 * inheriting the sidebar's, and that the BROWSE arm inherits nothing.
			 */
			include: false,
			facts: {},
			/*
			 * And the tombstones, which are the half this call site was missing: the
			 * set of ids this window must not draw, from a row OR from a cached hit.
			 */
			forgotten: new Set(Object.keys(forgotten)),
		}),
		[forgotten],
	);
	/*
	 * THE VISITED RING and the conversation on screen, the two facts the Recents
	 * pin is built from (`conversationRecents`, `ui-preferences-store.ts`). The
	 * displayed id is the shell's own rule (`panelSessionIdOfView`, the same call
	 * `app.tsx` records visits from) rather than `activeSessionId`, which a staged
	 * draft leaves pointing at the conversation the reader came FROM: reading that
	 * field would exclude the wrong row while a draft is on screen.
	 */
	const conversationRecents = parseConversationRecents(
		useUiPreferencesStore((state) => state.conversationRecents),
	);
	const displayedSessionId = useCanonicalSessionsStore((state) => {
		const draft = state.activeDraftKey
			? state.drafts[state.activeDraftKey]
			: undefined;
		return panelSessionIdOfView(
			state.activeDraftKey,
			draft?.sessionId,
			state.activeSessionId,
		);
	});
	/*
	 * THE ARCHIVE FACTS, read for the Recents pin's membership only. An accepted
	 * archive press settles `archiveFacts[sessionId]` and patches no catalogue row
	 * (D27), so the row's own `archived` goes stale until the next catalogue read;
	 * the sidebar overlays these facts first (`answeredArchiveRows`), and the pin
	 * must too or it keeps claiming a conversation the reader just archived (agent
	 * review round 2, R2-1). Being a memo input is the whole point: without it the
	 * memo would not rebuild when the fact settles.
	 */
	const archiveFacts = useCanonicalSessionsStore((state) => state.archiveFacts);
	const chatItems = useMemo(() => {
		if (!wantsChats) return [];
		const { rows } = searchChats(sessions, terms, hits, {}, archiveView);
		const byId = new Map((hits ?? []).map((hit) => [hit.id, hit]));
		return rows.map((row, index) => {
			const hit = byId.get(row.session_id);
			const labelMatch = matchesLabel(row, terms);
			const item = buildChatItem(row, teamLabels);
			const recents = chatRecentsOfRow(
				row,
				conversationRecents,
				displayedSessionId,
				archiveEnabled,
				archiveFacts,
			);
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
				/*
				 * The row's read state, from the store's single predicate — the same
				 * `unreadMarkKind` behind the sidebar's per-row mark — so the palette's
				 * Unread pin (issue #760) cannot become a second derivation of a fact
				 * the store already owns. A synthesized row (a hit this client does not
				 * list) carries no attention and answers false here, which is correct:
				 * nothing has been read or unread about a conversation this window
				 * cannot draw.
				 */
				unread: unreadMarkKind(row) !== null,
				/*
				 * The Recents pin's three facts (see `PaletteItem.recentRank`, `.current`
				 * and `.archived`), derived by `chatRecentsOfRow` from the row, the
				 * visited ring and the displayed-session value - ALL THREE derived from
				 * the same live catalogue row as everything above, so an id in the ring
				 * whose conversation is gone has no item here to carry a rank, and the
				 * ring can never resurrect one.
				 */
				recentRank: recents.recentRank,
				current: recents.current,
				archived: recents.archived,
			} satisfies PaletteItem;
		});
	}, [
		sessions,
		terms,
		hits,
		wantsChats,
		archiveView,
		teamLabels,
		conversationRecents,
		displayedSessionId,
		archiveEnabled,
		archiveFacts,
	]);

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
			/*
			 * The chat row is the DRAFT DOOR (issue #844). It used to carry a `path`
			 * target naming the `/chat/<agent id>` route, a route whose only
			 * non-session fallback (`sessionByAgent`) had a reader and no writer, so
			 * every press landed on the "legacy link" notice. It now stages the same
			 * `draft:agent:<name>` row the sidebar's "New chat with <name>" and the agent
			 * page's own New chat produce, so the palette is a second door to that room
			 * rather than a second implementation of one.
			 *
			 * Gated on `canStageDraft` (the sidebar's own New-chat gate): this row's
			 * only action is to stage a draft, so a backend that cannot create sessions
			 * must not be offered it. The settings row below is unaffected - it opens a
			 * registry-backed page, not a draft.
			 */
			if (canStageDraft)
				items.push({
					id: `agent-chat-${agent.id}`,
					kind: "agent",
					group: "agents",
					name: agent.name,
					/*
					 * The kind is IN the hint (issue #849): the `@` scope draws agents and
					 * teams together, a team may share an agent's name, and the section
					 * heading is off-screen the moment the list scrolls. "Agent chat" vs
					 * "Team chat" is the one word that tells the pair apart.
					 */
					hint: "Agent chat",
					/*
					 * The glyph is the ENTITY, matching the team row beside it and the sidebar
					 * these rows stage a draft from (design round 1, D4). The pair under `@` is
					 * two entities, so both wear the entity's own mark - `agents` is the
					 * palette's `Bot`, the same glyph the sidebar's agent row carries - and the
					 * KIND rides in the hint above. Before this the agent row wore the ACTION's
					 * mark (`chat`, a speech bubble) while its sibling wore an entity's, so one
					 * list carried two grammars.
					 */
					icon: "agents",
					keywords: agent.tags,
					target: { type: "draft", kind: "agent", name: agent.name },
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
	}, [
		canStageDraft,
		roster.data,
		nameFiltered.data,
		terms.length,
		wantsAgents,
	]);

	/* -------------------------------- teams -------------------------------- */

	const teamItems = useMemo(() => {
		if (!wantsTeams) return [];
		/*
		 * One row per team (issue #849), from the SAME `useTeams` call the chat rows'
		 * labels come from - one fetch, one answer about which teams exist. The row's
		 * action is the draft door, so it is gated on `canStageDraft` exactly as the
		 * sidebar's "New chat with <label>" rows are.
		 *
		 * WHAT THE ROW READS vs WHAT IT STAGES: `name` is the team's display label
		 * (the string a person reads, `teamDisplayName`'s rule), while the draft's key
		 * is the SLUG (`team.name`) - the string the sidebar's rows, the catalogue
		 * keys and the wire all address a team by, so the palette and the sidebar
		 * stage the same `draft:team:<slug>` row rather than two drafts for one team.
		 */
		if (!canStageDraft) return [];
		return (teamNames.data ?? []).map((team, index) => ({
			id: `team-chat-${team.name}`,
			kind: "team" as const,
			group: "teams" as const,
			name: teamDisplayName(team),
			hint: "Team chat",
			icon: "team" as const,
			keywords: [team.name, ...(team.aliases ?? [])],
			target: {
				type: "draft" as const,
				kind: "team" as const,
				name: team.name,
			},
			featured: terms.length === 0,
			order: index,
		}));
	}, [canStageDraft, teamNames.data, terms.length, wantsTeams]);

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
	 * door to the same room: the row names a destination and a presenter mounts it
	 * (`panel-presentation-store.ts`), so there is one implementation of each panel
	 * and one idea of what a destination means.
	 *
	 * The gate differs by what the row NEEDS, and the difference is the whole of
	 * the operator's first requirement. `/info`, `/usage` and `/analytics` describe
	 * the machine and read no conversation, so they are gated on liveness alone
	 * — `canStageDraft`, the same capability bit the chat route and the sidebar
	 * read — plus one term about the CREDENTIAL (`desktopPlaneRefused`, above):
	 * an origin that answers `/v1/capabilities` but refuses every desktop op this
	 * app makes offers no row here, because a row that opens a panel reading
	 * "Desktop authorization is required." per section is the dead control this
	 * palette refuses to offer, reached by a longer route. Gating them on a pane,
	 * as every row here once was, hid them from the palette on exactly the pages
	 * they are now readable from — and a driver run with no backend found the other
	 * half of the same defect, which is why the liveness bit stays: with no backend
	 * the rows are absent rather than offered and inert (the chat route paints
	 * "Connecting to the backend..." where a pane would be, and nothing at all can
	 * answer a machine panel there).
	 *
	 * `Session` and `Analytics`' conversation half additionally need a real
	 * conversation, which is why `/session` keeps the pane gate: it reports on a
	 * session, so on a draft pane it would report on one that does not exist.
	 *
	 * ARGUED ALTERNATIVE, rejected: gate the three machine rows on `diagnostics`,
	 * the capability the panels themselves read. That would hide the rows on a
	 * backend that lacks the routes — and the panels already render their own
	 * update notice for that case, which is a sentence on screen rather than a row
	 * that is simply missing. The liveness bit is also the gate this palette holds
	 * every other row to, so the second opinion would be a new rule for three rows.
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
	 * A session-scoped panel is presented by the pane only (`SessionPanel`, which
	 * owns the presentation slot), and the pane only exists when the catalogue
	 * capability is live and the route resolves to a session or a draft. With the
	 * backend down the chat route paints "Connecting to the backend..." instead, so
	 * a panel row there would close the palette and do nothing - the dead control
	 * this palette refuses to offer, and the exact defect a driver run with no
	 * backend found. The machine panels are the exception, and the only one: they
	 * have a shell host as well (`panel-outlet.tsx`), so they are gated on the
	 * liveness bit directly rather than on this.
	 *
	 * `canStageDraft` is that same capability, read at the same version the chat
	 * route and the sidebar read it, rather than a second opinion about it.
	 */
	const paneCanPresent =
		canStageDraft && Boolean(activeSessionId ?? activeDraftKey);
	/*
	 * A conversation reading needs a conversation: `/session` on a draft would
	 * report on a session that does not exist yet.
	 */
	const sessionPanelsAvailable = Boolean(activeSessionId);

	const panelItems = useMemo(() => {
		if (!canStageDraft || desktopPlaneRefused) return [];
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
			...(paneCanPresent && sessionPanelsAvailable
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
					]
				: []),
			/* After the pane-only row, so the group keeps the order it had when all
			 * four were gated together: `Session` only ever appears on a live
			 * conversation, and `Analytics` is the row that is now always there. */
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
		]);
	}, [
		canStageDraft,
		desktopPlaneRefused,
		paneCanPresent,
		sessionPanelsAvailable,
	]);

	/* ------------------------ destinations and actions ---------------------- */

	const items = useMemo(
		() => [
			...buildNavigationItems(pages),
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
			...teamItems,
			...chatItems,
		],
		[
			isOnChatPage,
			hasConversation,
			isCanvasOpen,
			canStageDraft,
			pages,
			panelItems,
			settingItems,
			agentItems,
			teamItems,
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
			catalogue:
				sessions.length > 0
					? "loaded"
					: sessionsLoading || !catalogueAsked.current
						? "loading"
						: "empty",
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
		/*
		 * Connecting a provider is the first thing a new install needs and the
		 * palette is where a keyboard user looks for it (design audit section 6).
		 * It opens the connect dialog over the current page rather than routing
		 * to Settings, so the chat the user is in survives. The "login" synonyms
		 * that already route to the Providers section row stay there; this row
		 * adds the action beside the destination.
		 */
		{
			id: "connect-provider",
			name: "Connect a model provider",
			icon: "providers" as const,
			keywords: [
				"sign in",
				"login",
				"api key",
				"add provider",
				"claude",
				"chatgpt",
				"radient",
				"model",
			],
			verb: "Connect",
			command: "connect-provider" as const,
			featured: true,
		},
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
