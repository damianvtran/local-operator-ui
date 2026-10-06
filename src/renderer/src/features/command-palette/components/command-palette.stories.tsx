import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import {
	AGENT_ROSTER_SEED,
	CONVERSATION_SWITCHER_SEED,
} from "../palette-search";
/* Also imported by the Storybook preview; kept here so the file is honest
   about what it needs to render, and so it renders if run in isolation. */
import "../../../styles/index.css";
import { CommandPalette } from "./command-palette";
/**
 * The command palette, open.
 *
 * ## Why the store is driven rather than a prop
 *
 * `CommandPalette` takes no props: it reads `isCommandPaletteOpen` and the
 * query straight out of `useUiPreferencesStore`, because in the app it is
 * mounted once at the root and opened from anywhere. A story that wanted to
 * pass `open` would be testing a component that does not exist.
 *
 * ## Why `data-theme` goes on `documentElement`
 *
 * The palette is a Radix dialog and portals to `document.body`, outside any
 * wrapper this story could render. With the theme only on a wrapper every
 * `--lo-*` read inside the portal resolves to nothing and the panel comes out
 * unstyled. The preview frame in `.storybook/preview.tsx` puts it on the root
 * for every story.
 *
 * ## What these stories cannot show
 *
 * There is no backend here, so the roster and the conversation SEARCH are
 * absent: a term typed into the field cannot reach `sessions.search`, and the
 * agent roster cannot be read at all. What CAN be shown, and is (the three
 * chats-scope stories below), is the conversations CATALOGUE — the rows the
 * browse list draws. Those come from the canonical session store, which is
 * local state the app fills from the backend, and priming it renders the same
 * list a live backend produces: same rows, same browse cap, same footer. The
 * IPC half of the Cmd/Ctrl+P chord (main's `before-input-event`, which cannot
 * fire in a gallery) is the running app's evidence — `docs/evidence/` and QA's
 * live pass — and what these stories add is the state that pass had no
 * conversations for: populated, empty and cold-open rows, judged as pixels.
 *
 * The conversation and registry stories otherwise live in the app's own
 * evidence rather than here: `docs/evidence/command-palette-commandpalette/` is
 * the Storybook set, and the frames taken from the running app are what show a
 * chat matched by its body.
 */
type StoryArgs = {
	/** Seeded into the store before the palette opens. */
	query: string;
};

const PaletteFrame = ({ query }: StoryArgs) => {
	/*
	 * Deliberately a passive effect, not a layout effect.
	 *
	 * `CommandPalette` two-way binds the query: it seeds local state from the
	 * store and writes the settled local value back. That write-back is a passive
	 * effect, and passive effects run child-first — so a layout effect here set
	 * the query and the palette immediately wrote its own empty initial value
	 * over it, and the query stories rendered the unfiltered list. Seeding from a
	 * passive effect in the parent lands last.
	 */
	useEffect(() => {
		const store = useUiPreferencesStore.getState();
		store.setCommandPaletteQuery(query);
		store.openCommandPalette();
		return () => {
			useUiPreferencesStore.getState().closeCommandPalette();
		};
	}, [query]);

	return <CommandPalette />;
};

const meta: Meta<StoryArgs> = {
	title: "Command palette/CommandPalette",
	parameters: { layout: "fullscreen" },
	argTypes: {
		query: { control: "text" },
	},
	args: { query: "" },
	render: ({ query }) => <PaletteFrame query={query} />,
};

/* ------------------------------------------------------- the roster world -- */

/**
 * ONE AGENT AND ONE TEAM, for the `@` scope's two row kinds (issue #849).
 *
 * The palette's roster is the only part of it that needs a BACKEND: the
 * conversations catalogue is local store state a story can prime, but agents and
 * teams arrive from `profiles.list` / `teams.list` over the desktop bridge. So
 * this story stubs that bridge (`window.api.desktop.request`, the same bridge
 * `agent-class.stories.tsx` installs) and answers from an in-memory world — the
 * transport and the hooks are real, the server is the stand-in. An op nobody
 * stubbed THROWS, so a palette that grows a read photographs an error rather
 * than an empty shell that looks like a working empty state.
 */
const envelope = (result: unknown) => ({ status: 200, body: { result } });

/**
 * The capability answer the roster needs. `session_catalogue: 2` is not
 * decoration: it is `canStageDraft`, the gate the agent and team rows carry, and
 * a fixture without it renders no rows at all (which is the honest state of a
 * backend that cannot stage a draft, and its own story's subject rather than
 * this one's).
 */
const ROSTER_CAPABILITIES = {
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
	features: {
		profile_catalogue: 1,
		team_catalogue: 1,
		session_catalogue: 2,
		settings: 1,
	},
};

const ROSTER_AGENT = {
	id: "agent-ledger-auditor",
	name: "ledger-auditor",
	description: "Audits ledger entries against their source documents.",
	tags: ["finance", "audit"],
	working_directory: "/tmp/ledger-auditor",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

/**
 * A team with a LABEL, and the label is the point: the row READS "Delivery crew"
 * while the draft it stages is keyed by the slug `delivery`. A fixture whose
 * label equalled its slug would let the two names be confused with nothing on
 * screen to say so.
 */
const ROSTER_TEAM = {
	id: "team-delivery",
	name: "delivery",
	label: "Delivery crew",
	aliases: ["shipping"],
	description: "Ships the product.",
	manager: "aida",
	members: [],
};

const installRosterBridge = ({
	withAgent = true,
	withTeam = true,
}: { withAgent?: boolean; withTeam?: boolean } = {}) => {
	/*
	 * THE AGENT ROSTER IS NOT A DESKTOP-BRIDGE READ. `useAgents` goes through
	 * `desktopControlResponse({ op: "legacy.agents.list" })`, so the ROWS arrive on
	 * the bridge — but the hook is gated by `useConnectivityGate`, which asks
	 * `/health` over plain `fetch` against the configured API origin. Without a
	 * second stub the gate reports the server offline and the roster query never
	 * runs, so the frame would show an empty `@` scope and look like a palette bug.
	 * Only `/health` is answered; every other URL falls through to the real fetch,
	 * so a story that grows a network read fails loudly rather than silently
	 * photographing this file's idea of the answer.
	 */
	const realFetch = window.fetch.bind(window);
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : String(input);
		if (url.includes("/health"))
			return new Response(
				JSON.stringify({ result: { status: "ok", version: "0.0.0-story" } }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		return realFetch(input as RequestInfo, init);
	}) as typeof window.fetch;

	const handler = async (request: { op: string }) => {
		switch (request.op) {
			case "capabilities":
				return envelope(ROSTER_CAPABILITIES);
			case "legacy.agents.list":
				return envelope({
					agents: withAgent ? [ROSTER_AGENT] : [],
					total: withAgent ? 1 : 0,
					page: 1,
					per_page: 50,
				});
			case "profiles.list":
				return envelope({ profiles: [] });
			case "teams.list":
				return envelope({ teams: withTeam ? [ROSTER_TEAM] : [] });
			case "settings.list":
				return envelope({ settings: [] });
			case "sessions.list":
				return envelope({ sessions: [], total: 0 });
			default:
				throw new Error(
					`unexpected desktop op in the palette's roster story: ${request.op}`,
				);
		}
	};
	const page = window as unknown as {
		api?: { desktop?: { request: typeof handler } };
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler } as never;
};

/**
 * The roster frame: install the bridge, prime nothing (agents and teams come
 * from the bridge), open on the `@` seed, and mount the palette.
 *
 * The close-then-open dance and the one-commit deferral are the switcher
 * frame's, for the same two measured reasons (a persisted `isCommandPaletteOpen`
 * and child effects running before the parent's) — see `SwitcherFrame`.
 */
const RosterFrame = ({
	withAgent,
	withTeam,
}: { withAgent?: boolean; withTeam?: boolean }) => {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		installRosterBridge({ withAgent, withTeam });
		useUiPreferencesStore.getState().closeCommandPalette();
		useUiPreferencesStore.getState().toggleCommandPalette(AGENT_ROSTER_SEED);
		setReady(true);
		return () => {
			useUiPreferencesStore.getState().closeCommandPalette();
		};
	}, [withAgent, withTeam]);
	if (!ready) return null;
	return <CommandPalette />;
};

/*
 * Eight conversations, newest first: the order the browse list renders. Eight
 * against the browse cap of five is what makes the clip visible — five rows,
 * the rest reachable by typing. The footer of a browse shows the legend, not a
 * count line; the count renders only for a typed search, so the frame's footer
 * is the legend either way (R2-1). Titles are ordinary reading — the frame
 * exists to be judged for hierarchy and density, and a fixture does not need
 * the content to mean anything.
 */
const CATALOGUE_ROWS: CanonicalSessionRow[] = [
	"Retention policy for audit logs",
	"Quarterly planning notes",
	"Enrichment pipeline review",
	"Customer sync debugging",
	"Docs: onboarding rewrite",
	"Pricing page copy edits",
	"Incident 2026-09-24 postmortem",
	"Data agent catalogue spike",
].map((title, index) => ({
	session_id: `rig-switcher-${index + 1}`,
	title,
	updated_at: 1_760_000_000 - index * 3_600,
}));

/**
 * The seeded door's own frame: `toggleCommandPalette` with the switcher seed —
 * the exact call the Cmd/Ctrl+P subscription makes — over a primed catalogue.
 *
 * WHY THE PRIMED CATALOGUE IS FAIR (review round 2, D1): the switcher's rows
 * render from the canonical session store, and a story that primes it shows
 * the list a live backend produces — same rows, same cap, same footer. The
 * one thing a story cannot photograph is the IPC half of the chord, and that
 * half is the app's own evidence; these frames exist because the design round
 * could not judge hierarchy, row density or the footer from an empty fixture.
 * The previous chats story opened via `openCommandPalette` + a query arg,
 * which was a second answer to "where does the palette open from" — this
 * frame uses the store's own door so the story and the app cannot drift.
 */
const SwitcherFrame = ({
	state,
}: {
	state: "populated" | "empty" | "loading";
}) => {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		/*
		 * TWO THINGS THIS EFFECT HAS TO GET RIGHT, both measured rather than
		 * reasoned:
		 *
		 * 1. `isCommandPaletteOpen` is PERSISTED (`persistedUiPreferences` keeps
		 *    it), so a gallery reload after any earlier open rehydrates the store
		 *    OPEN — and the real door's TOGGLE would then CLOSE the palette. The
		 *    story's first frames were blank for exactly this reason (the effect
		 *    logged `isCommandPaletteOpen true` at setup on a fresh iframe load);
		 *    the close first makes the start state deterministic.
		 * 2. The palette must not MOUNT until the catalogue is primed. Child
		 *    effects run before the parent's, and against a persisted-open store
		 *    the palette's once-per-open catalogue fetch fired before this
		 *    effect's prime landed — the failed fetch settled `loading` back to
		 *    false and the loading frame rendered the settled-empty copy instead
		 *    (measured in the round-2 captures). `ready` defers the mount by one
		 *    commit, so the component's first render already sees the fixture.
		 */
		useUiPreferencesStore.getState().closeCommandPalette();
		const sessions = useCanonicalSessionsStore.getState();
		const originalSessions = sessions.sessions;
		const originalLoading = sessions.loading;
		useCanonicalSessionsStore.setState({
			sessions: state === "populated" ? CATALOGUE_ROWS : [],
			loading: state === "loading",
		});
		useUiPreferencesStore
			.getState()
			.toggleCommandPalette(CONVERSATION_SWITCHER_SEED);
		setReady(true);
		return () => {
			useUiPreferencesStore.getState().closeCommandPalette();
			useCanonicalSessionsStore.setState({
				sessions: originalSessions,
				loading: originalLoading,
			});
		};
	}, [state]);

	if (!ready) return null;
	return <CommandPalette />;
};

export default meta;
type Story = StoryObj<StoryArgs>;

/**
 * Opened with no query: the browse layout, and the state that teaches the
 * prefixes.
 */
export const Default: Story = {};

/** A query that spans more than one source, showing how the groups order. */
export const Filtered: Story = { args: { query: "agent" } };

/**
 * A settings query, which is where the alias table earns its place: "theme" is
 * not a word in the settings rail, and the row it finds is called Appearance.
 */
export const SettingsScope: Story = { args: { query: ",theme" } };

/**
 * The command scope on its own: `>` is "show me what the app can do", which is
 * the browse layout narrowed to destinations, actions and panels.
 *
 * The Panels group is absent here, and that absence is the gate working rather
 * than missing evidence: every panel is presented by the chat pane, a story has
 * no pane, and the palette does not offer a row it could not deliver. The rows
 * themselves are covered by the ranking tests and the live-app QA pass.
 */
export const CommandsScope: Story = { args: { query: ">" } };

/**
 * The chats scope with NO conversations: the empty state the switcher settles
 * into once the catalogue has answered (and the frame design round 2 asked for
 * alongside the populated one). The `# Chats` chip beside the field names the
 * scope whenever one is applied; the footer's legend draws in its own states —
 * every browse, empty or full — and teaches the other prefixes (R2-1).
 */
export const ChatsScope: Story = {
	render: () => <SwitcherFrame state="empty" />,
};

/**
 * The switcher POPULATED: eight conversations against the browse cap of five,
 * so the five-row clip and the row rhythm — the states the design round could
 * not judge from an empty fixture — are the frame. Its footer is the legend,
 * not a count line: the count renders only for a typed search (R2-1).
 */
export const ChatsScopePopulated: Story = {
	render: () => <SwitcherFrame state="populated" />,
};

/**
 * Cold open: the catalogue request is out and unanswered. This is the frame
 * that proves the loading copy — the state the old empty-state sentence used
 * to misstate as "nothing to show" before the fetch answered.
 */
export const ChatsScopeLoading: Story = {
	render: () => <SwitcherFrame state="loading" />,
};

/**
 * The no-results state, which has to say what to try next — and, in the app,
 * must not claim it while the conversation search is still out.
 */
export const NoResults: Story = { args: { query: "zzzz" } };

/**
 * The `@` scope with the AGENT row (issues #844, #849): the row's hint is
 * `Agent chat`, and its target is the draft door rather than the `/chat/<agent
 * id>` path that always landed on the legacy-link notice.
 *
 * The frame is judged for the row's own reading — name, the kind word in the
 * hint, the group heading — and the flow (the press landing on a chat targeted
 * at that agent) is the running app's, in `docs/agent-driver.md`'s own lane.
 */
export const AgentRosterRow: Story = {
	render: () => <RosterFrame withAgent withTeam={false} />,
};

/**
 * The same scope with a TEAM row, under its own `Teams` heading: one row per
 * team, reading the display label while the draft it stages is keyed by the
 * slug.
 *
 * This and the frame above are the pair that says a same-named agent and team
 * cannot be confused, which is what the kind-carrying hint exists for.
 */
export const TeamRosterRow: Story = {
	render: () => <RosterFrame withAgent={false} withTeam />,
};

/**
 * Both kinds at once, which is the `@` scope's ordinary state in the app: this
 * is the frame that shows the two groups' order and the two hints side by side.
 */
export const RosterScope: Story = {
	render: () => <RosterFrame withAgent withTeam />,
};
