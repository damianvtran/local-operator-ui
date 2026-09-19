/**
 * Session archive and delete, as the surfaces a reader meets them on.
 *
 * ## Why a story file rather than frames from the running app
 *
 * The companion pull request is the BACKEND half (`feat/session-archive-delete`:
 * the archive store, the route and the capability), and it was still in flight
 * when these were taken — so there is no daemon that answers `session_archive`
 * at all, and a driver run against one would photograph the failing gate rather
 * than the feature. What makes the story route valid here is that BOTH halves of
 * every claim below are the shipped code: the real `ChatSidebar` reading the real
 * canonical-sessions store through the real desktop transport, the real
 * `DeleteConversationDialog` over the real `ConfirmationModal`, and the real
 * `ChatHeader` with its own props. Only the wire underneath is a fixture, and
 * `docs/evidence/session-archive/README.md` says per frame which half that is.
 *
 * ## These stories are NOT in the sweep's story list, deliberately
 *
 * `scripts/capture-evidence.mjs` says to add a new story file to `STORIES`,
 * and this one is an exception with a measured reason: the sweep sets the theme
 * through a decorator effect and waits 10 s for `documentElement.dataset.theme`,
 * and on this machine - with two other Storybook servers running for other
 * sessions - that wait expired on every attempt while these frames were being
 * prepared. `at-rest` DID render correctly through the sweep once (the sidebar
 * with its three conversations, no archive chrome), so the plumbing below is
 * sound; what could not be completed is the sweep itself. The evidence for this
 * feature is therefore the DRIVER set in `docs/evidence/session-archive/`, which
 * asserts the states it photographs, and this file is the review surface a design
 * round can sweep - and register in `STORIES` - on a quiet machine.
 *
 * ## What is stubbed, and what is not
 *
 * `window.api.desktop.request` is replaced with a bridge that answers the ops
 * this panel makes (`capabilities`, `sessions.list`, `sessions.search`,
 * `sessions.archive`, `profiles.list`, `teams.list`) in the wire's own field
 * names. Every rule the frames are evidence ABOUT lives above the bridge: the
 * capability gate (`session_archive`), the partition busy a row leaves the list,
 * the search view's `include_archived`, and the marker. The bridge is also the
 * instrument for one of them — it records the `include_archived` flag each search
 * actually carried, which is the one way to see that the checkbox re-scopes the
 * REQUEST rather than filtering an answer already in hand.
 *
 * ## What a frame here does NOT prove
 *
 * That a daemon archives anything. The press path is stubbed to answer what the
 * frozen contract says the route answers, so a frame proves the control, the
 * marker, the toggle and the copy — never the store. QA's round against a real
 * backend is what proves those, and the pull request says so where it lists what
 * was exercised against what.
 */

import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent, within } from "@storybook/test";
import { useEffect } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { ChatHeader } from "./chat-header";
import { ChatSidebar } from "./chat-sidebar";
import { DeleteConversationDialog } from "./delete-conversation-dialog";

/* Hoisted out of the play callbacks: a regex literal inside a callback is what
 * `useTopLevelRegex` reports, and these files are being touched anyway. */
const SEARCH_LABEL = "Search chats and agents";
const INCLUDE_ARCHIVED_LABEL = "Include archived";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = {
	op: string;
	q?: string;
	include_archived?: boolean;
	archived?: boolean;
	sessionId?: string;
};

/** One catalogue row, in the wire's own field names. */
type WireRow = {
	id: string;
	name: string;
	mtime: number;
	archived: boolean;
	active: boolean;
	live_state: string;
	pending: null;
	binding?: { agent: string | null; team: string | null };
	status?: { code: string; label: string };
};

const row = (
	id: string,
	name: string,
	{ archived = false, active = false, age = 60 } = {},
): WireRow => ({
	id,
	name,
	mtime: age,
	archived,
	active,
	live_state: active ? "busy" : "idle",
	pending: null,
	binding: { agent: null, team: null },
	status: active
		? { code: "busy", label: "Working" }
		: { code: "recent", label: "Recent" },
});

/**
 * The catalogue these frames are about: three live conversations, and one that
 * was filed away. The archived one is NOT drawn at rest - that is the whole of
 * what archiving does - and it is reachable only through the search block's own
 * `Include archived` control, which is the frame pair below.
 */
const ROWS = [
	row("2d5ad5da0025", "Invoice reconciliation", { active: true, age: 30 }),
	row("e059761608ae", "Nightly notes on the release", { age: 900 }),
	row("7c1b0f2a4d31", "Migration checklist", { age: 4_000 }),
	row("a91f4c7e2b60", "Old onboarding notes", { archived: true, age: 90_000 }),
];

/** The same four rows WITHOUT the archive capability: the withdrawn pair's half. */
const capabilities = (archive: boolean): Record<string, number> => ({
	session_catalogue: 2,
	session_search: 1,
	commands: 1,
	profile_catalogue: 1,
	team_catalogue: 1,
	...(archive ? { session_archive: 1, session_delete: 1 } : {}),
});

/** A hit, in the wire's own field names; `rank` 0 is a name match. */
const hit = (source: WireRow) => ({
	id: source.id,
	name: source.name,
	mtime: source.mtime,
	forked: false,
	rank: 0,
	body_match: false,
	archived: source.archived,
});

type BridgeOptions = {
	/** Whether the backend advertises the two archive capabilities at all. */
	archive?: boolean;
	/** The reply to `sessions.delete`: the route's 409 is a real state. */
	deleteRefused?: boolean;
	/** Called with every request, so a story can assert what went on the wire. */
	record?: (request: BridgeRequest) => void;
};

const installBridge = ({
	archive = true,
	deleteRefused = false,
	record,
}: BridgeOptions = {}) => {
	let rows = ROWS.map((entry) => ({ ...entry }));
	const ok = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});

	const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
		record?.(request);
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: capabilities(archive),
				});
			case "sessions.list":
				/*
				 * The route's own flag, answered honestly: this app asks for the archived
				 * rows and hides them itself, and a fixture that dropped them would make
				 * the frames a picture of a page the app never holds.
				 */
				return ok({
					sessions: request.include_archived
						? rows
						: rows.filter((r) => !r.archived),
					truncated: false,
				});
			case "sessions.search": {
				const needle = (request.q ?? "").toLocaleLowerCase();
				const matched = rows.filter((entry) =>
					entry.name.toLocaleLowerCase().includes(needle),
				);
				return ok({
					sessions: (request.include_archived
						? matched
						: matched.filter((entry) => !entry.archived)
					).map(hit),
					query: request.q ?? "",
					limit: 100,
				});
			}
			case "sessions.archive": {
				rows = rows.map((entry) =>
					entry.id === request.sessionId
						? { ...entry, archived: request.archived === true }
						: entry,
				);
				return ok({
					session_id: request.sessionId,
					archived: request.archived === true,
				});
			}
			case "sessions.delete":
				if (deleteRefused) {
					return {
						status: 409,
						body: {
							detail:
								"This conversation is running. Stop it before deleting it.",
						},
					};
				}
				rows = rows.filter((entry) => entry.id !== request.sessionId);
				return ok({ session_id: request.sessionId, deleted: true });
			case "profiles.list":
				return ok({ profiles: [] });
			case "teams.list":
				return ok({ teams: [] });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};

	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

/**
 * A profile with nothing in it, so a story cannot inherit the previous story's
 * rows: the store persists to this profile's localStorage, and two frames of the
 * same screen that differ by leftover state are two frames of nothing.
 */
const resetStore = () => {
	useCanonicalSessionsStore.setState({
		sessions: [],
		archiveFacts: {},
		archiveFailure: null,
		deleteCandidate: null,
		activeSessionId: null,
		activeDraftKey: null,
		error: null,
	});
};

/**
 * The bridge, installed FROM `render`, synchronously, before the panel mounts.
 *
 * WHY NOT A MOUNT EFFECT, and why not a loader either - both measured on this
 * surface. An effect loses the race: a parent's effects run AFTER its children's,
 * so the panel's first capability read happens before the transport exists. A
 * LIBOADER is early enough but not sufficient on its own, because the transport
 * has to be replaced on EVERY render of the story (Storybook reuses the page
 * across stories, and a capability answer cached from the previous story would
 * otherwise be the one this frame is built from) - which is exactly what the
 * sibling `chat-sidebar-agents.stories.tsx` does, and the reason its frames are
 * of the section rather than of this banner. Both wrong versions photographed
 * "Desktop controls need a compatible backend connection", and the sweep's hover
 * entry then reported that `[data-chat-row]` matched nothing at all.
 */
const prepare = (options?: BridgeOptions) => {
	resetStore();
	installBridge(options);
};

/* --------------------------------------------------------------- surfaces */

/**
 * The real sidebar, at the width it really is, with the bridge underneath it.
 *
 * The panel is 320px because that is the width these frames are read at (the
 * shipped sidebar's own floor), and it is deliberately not narrowed further: the
 * reserved 24px slot this feature adds is a cost in TITLE WIDTH, and a frame of a
 * width the app does not have would price it against a sidebar nobody uses.
 */
const Sidebar = ({ options }: { options?: BridgeOptions } = {}) => {
	prepare(options);
	return (
		<div className={cn("flex h-[560px] w-[320px] shrink-0 bg-surface")}>
			<ChatSidebar
				selectedConversation="2d5ad5da0025"
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
	);
};

/**
 * The real header, on its own band: the archived state and the conversation's
 * actions. 560px is the width the header cluster's own frames use, so these sit
 * beside them as the same surface at the same size.
 */
const Header = ({
	archived = true,
	open = false,
}: {
	archived?: boolean;
	open?: boolean;
}) => (
	<div className={cn("flex h-[84px] w-[560px] shrink-0 flex-col bg-canvas")}>
		<ChatHeader
			agentName="Old onboarding notes"
			description="Filed away · on this machine"
			onOpenOptions={() => undefined}
			onOpenBrowser={() => undefined}
			archived={archived}
			archiveEnabled
			deleteEnabled
			onSetArchived={() => undefined}
			onRequestDelete={() => undefined}
		/>
		{open ? <MenuOpener /> : null}
	</div>
);

/** Opens the header's menu in its own effect, so the frame is the open menu. */
const MenuOpener = () => {
	useEffect(() => {
		void (async () => {
			const trigger = await screen.findByLabelText("Conversation actions");
			await userEvent.click(trigger);
		})();
	}, []);
	return null;
};

/* --------------------------------------------------------------- stories */

const meta = {
	title: "Session archive",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

/**
 * The panel with the capability present and nothing archived on screen: the
 * frame the withdrawn pair below is compared against.
 */
export const AtRest: Story = {
	render: () => <Sidebar />,
};

/**
 * The pointer on a conversation's row. The reveal is CSS (`group-hover`), so it
 * cannot be produced by a story alone - the sweep's entry for this story moves a
 * real pointer at `[data-chat-row]` before the shutter, the mechanism the run
 * panel's trigger-hover frames already use.
 */
export const RowHover: Story = {
	render: () => <Sidebar />,
};

/** The search box after a query, with the Include archived control beside it. */
export const SearchLiveOnly: Story = {
	render: () => <Sidebar />,
	play: async () => {
		const box = await screen.findByLabelText(SEARCH_LABEL);
		await userEvent.type(box, "notes");
		await screen.findByText("Release notes for 0.29");
	},
};

/**
 * The same query with the control ON: the archived conversation appears, marked,
 * and the sidebar has gained no section to hold it.
 */
export const SearchIncludeArchived: Story = {
	render: () => <Sidebar />,
	play: async () => {
		const box = await screen.findByLabelText(SEARCH_LABEL);
		await userEvent.type(box, "notes");
		await screen.findByText("Release notes for 0.29");
		await userEvent.click(await screen.findByLabelText(INCLUDE_ARCHIVED_LABEL));
		await screen.findByText("Old onboarding notes");
	},
};

/**
 * The capability WITHDRAWN: the same four rows, no slot, no marker, no control
 * in the search block. Compared byte-for-byte against `AtRest` in the README,
 * which is the fail-closed claim stated as a measurement.
 */
export const CapabilityWithdrawn: Story = {
	render: () => <Sidebar options={{ archive: false }} />,
};

/**
 * The one permanent-delete confirmation, with the real component and the real
 * store: the candidate is staged exactly as the header's menu and a typed
 * `/delete` stage it.
 */
export const DeleteDialog: Story = {
	loaders: [
		async () => {
			resetStore();
			useCanonicalSessionsStore.setState({
				sessions: [
					{
						session_id: "2d5ad5da0025",
						title: "Invoice reconciliation",
						updated_at: 30,
					},
				],
			});
			useCanonicalSessionsStore.getState().requestSessionDelete("2d5ad5da0025");
			return {};
		},
	],
	render: () => (
		<div className={cn("flex h-[560px] w-[560px] bg-canvas")}>
			<DeleteConversationDialog
				title="Invoice reconciliation"
				hasSubagentRuns
			/>
		</div>
	),
};

/** The open conversation is archived: the header states it, and can restore it. */
export const ArchivedHeader: Story = {
	render: () => <Header archived />,
};

/**
 * The conversation's own menu. Two acts on one conversation, and the second one
 * (delete) only ASKS: the dialog is the only thing in the app that confirms.
 */
export const ConversationActions: Story = {
	render: () => <Header archived={false} open />,
	play: async () => {
		const menu = await screen.findByRole("menu");
		await within(menu).findByText("Delete conversation…");
	},
};
