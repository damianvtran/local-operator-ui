/**
 * The asks drawer in its TWO SCOPES, with the real top-level entry point.
 *
 * ## What is stubbed, and what is not
 *
 * `window.api.desktop.request` is the preload bridge `desktopRequest` prefers, so
 * the router below is the same seam the app itself uses: every op except
 * `asks.list` is refused, which is the honest state of a story whose subject is
 * one read. Everything above that seam is real - the real `ChatLayout` (whose
 * right slot the fleet pane is docked in), the real `SidebarNavigation` with its
 * real `Asks` row and badge, the real `FleetAskDrawer`, the real `AskDrawer` in
 * both scopes, and the real scope line both chrome bars compose from
 * `ask-queue.ts`. The payload is a fixture shaped like `GET /v1/desktop/asks` -
 * the row shape is the wire's (`PendingAsk` plus `session_id`/`cwd`, read from
 * `local_operator/asks/store.py`); the values in it are invented.
 *
 * ## What a frame here does NOT prove
 *
 * That a live backend answers this route, and above all that a real answer LANDS
 * in the right conversation: that is a property of the answer path
 * (`fleetAskSessionFor` plus `sessions.answer`), asserted by
 * `scripts/fleet-asks.test.mjs` and exercised end to end by QA against a real
 * `lop` - not something a still can carry. The other five ops being refused also
 * means the column's Browser/Mesh rows are absent here, which is the app's own
 * fail-closed rendering of a backend that answers nothing else, not a claim about
 * a normal install.
 *
 * ## Why the two scopes are one file and (below) one figure
 *
 * The operator's requirement is that the difference between the counts be
 * OBVIOUS: 3 inside a conversation and 11 at the top level describe different
 * things and both are right. Two frames taken minutes apart do not show that -
 * the pair does - so `ScopeComparison` draws the two real drawers beside the real
 * sidebar that carries the top-level badge, at the same instant, on one payload.
 * It is a FIGURE: one slot holds one pane in the product, so the story's name says
 * so and no evidence frame is taken from it (agent review round 1, F3).
 *
 * ## Naming, which is what the frames here are for
 *
 * `AppFrame` seeds the sessions catalogue, because a fleet card is named the way
 * the sessions list names the conversation (design review round 1, D1).
 * `FleetScopeOpen` is the ordinary state - every conversation titled;
 * `UntitledPairInOneRepo` is the collision: two untitled conversations in one
 * repository, told apart by the id's tail rather than printing one name twice.
 */

import { AskDrawer } from "@features/chat/components/asks/ask-drawer";
import { FleetAskDrawer } from "@features/chat/components/asks/fleet-ask-drawer";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { PaneSlot } from "@shared/components/common/pane-slot";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { DesktopResponse } from "../../../../../../shared/desktop-contract";

/* --------------------------------------------------------------- fixtures */

const MINUTE = 60_000;

type BridgeRequest = { op: string };

/** The desktop plane's answer envelope, as the preload bridge hands it to the API. */
const ok = <T,>(result: T): DesktopResponse => ({
	status: 200,
	body: { result },
});

/**
 * One aggregate row: the frozen `PendingAsk` shape plus the two keys a
 * cross-session view needs (`session_id`, `cwd`).
 *
 * The deadline is computed from the real clock because this surface's drawer
 * reads the live one (`useAskClock`) - a story cannot pin the fleet drawer's clock
 * the way the session drawer's `nowMs` prop does, and a fixture with fixed epoch
 * values would render every card dead the moment the story was recorded.
 */
const fleetRow = (over: {
	ask_id: string;
	session_id: string;
	cwd: string;
	status?: string;
	question: string;
	options?: string[];
}) => ({
	ask_id: over.ask_id,
	session_id: over.session_id,
	cwd: over.cwd,
	status: over.status ?? "open",
	created_at: Date.now() - 4 * MINUTE,
	expires_at: Date.now() + 26 * MINUTE,
	timeout_s: 1800,
	urgent: false,
	questions: [
		{
			id: "q",
			question: over.question,
			options: (over.options ?? ["Proceed", "Stop"]).map((label) => ({
				label,
			})),
			multi: false,
		},
	],
});

const PERGAMON = "abcdef123456";
const MINERVA = "123456abcdef";
const TOOLS = "feedfacecafe";

/**
 * THE CATALOGUE, as the sessions list holds it: the same rows `chat-sidebar.tsx`
 * names by `title`. Seeded so the frames prove the RULE the naming now follows -
 * a fleet card carries the name the list gives the conversation (design review
 * round 1, D1) - rather than the directory basename the first cut printed. One
 * conversation is deliberately left untitled, so the frame shows the fallback as
 * well as the title.
 */
const CATALOGUE = [
	{
		session_id: MINERVA,
		title: "Migrate the billing schema",
		cwd: "/Users/someone/minervaai",
	},
	{
		session_id: PERGAMON,
		title: "Enrichment backfill",
		cwd: "/Users/someone/pergamon-labs",
	},
	{
		session_id: TOOLS,
		title: "Phone portal deploy",
		cwd: "/Users/someone/tools/omp-mobile",
	},
];

/**
 * TWO CONVERSATIONS IN ONE REPOSITORY, NEITHER WITH A TITLE - the state the first
 * fixture could not show (`source-only`, design review round 1, D1) and the state
 * the operator's own install is in. Resolved together, the two cards are told
 * apart by the session id's tail; resolved one at a time they would print one
 * name twice.
 */
const PERGAMON_SECOND = "c0ffee5a5a5a";
const UNTITLED_PAIR = [
	fleetRow({
		ask_id: "a-u1",
		session_id: PERGAMON,
		cwd: "/Users/someone/pergamon-labs",
		question: "Should the enrichment backfill skip rows with no domain?",
		options: ["skip them", "hold them for review"],
	}),
	fleetRow({
		ask_id: "a-u2",
		session_id: PERGAMON_SECOND,
		cwd: "/Users/someone/pergamon-labs",
		question: "Re-run the failed shard on its own, or the whole suite?",
		options: ["its own", "whole suite"],
	}),
];

/**
 * ELEVEN outstanding asks across THREE conversations - the top-level count the
 * operator's own complaint was about (`3` beside a session-scoped view and `11`
 * here are both correct).
 */
const FLEET_ROWS = [
	fleetRow({
		ask_id: "a-f1",
		session_id: MINERVA,
		cwd: "/Users/someone/minervaai",
		question: "Which environment should the migration run against?",
		options: ["qa", "prod"],
	}),
	fleetRow({
		ask_id: "a-f2",
		session_id: MINERVA,
		cwd: "/Users/someone/minervaai",
		question: "Rotate the deploy token while I am here?",
		options: ["yes", "no"],
	}),
	fleetRow({
		ask_id: "a-f3",
		session_id: PERGAMON,
		cwd: "/Users/someone/pergamon-labs",
		question: "Should the enrichment backfill skip rows with no domain?",
		options: ["skip them", "hold them for review"],
	}),
	fleetRow({
		ask_id: "a-f4",
		session_id: PERGAMON,
		cwd: "/Users/someone/pergamon-labs",
		question: "I found 42 duplicate organisation records. Merge or report?",
		options: ["merge", "report only"],
	}),
	fleetRow({
		ask_id: "a-f5",
		session_id: TOOLS,
		cwd: "/Users/someone/tools/omp-mobile",
		question: "The phone portal deploy is ready. Push it?",
		options: ["push", "wait"],
	}),
	/* A timed-out ask: still answerable (the backend folds `timed_out` into the
	   outstanding set), and the panel must show it as its own state rather than
	   hiding it or reading it as settled. */
	fleetRow({
		ask_id: "a-f6",
		session_id: TOOLS,
		cwd: "/Users/someone/tools/omp-mobile",
		status: "timed_out",
		question: "Restart the tunnel now the certificate is renewed?",
	}),
	fleetRow({
		ask_id: "a-f7",
		session_id: TOOLS,
		cwd: "/Users/someone/tools/omp-mobile",
		question: "Delete the staging bucket's old snapshots?",
	}),
	fleetRow({
		ask_id: "a-f8",
		session_id: PERGAMON,
		cwd: "/Users/someone/pergamon-labs",
		question: "Publish the revised catalogue schema to the org?",
	}),
	fleetRow({
		ask_id: "a-f9",
		session_id: MINERVA,
		cwd: "/Users/someone/minervaai",
		question: "Which build should the phone portal pin?",
	}),
	fleetRow({
		ask_id: "a-f10",
		session_id: PERGAMON,
		cwd: "/Users/someone/pergamon-labs",
		question: "Re-run the failed shard on its own, or the whole suite?",
	}),
	fleetRow({
		ask_id: "a-f11",
		session_id: PERGAMON,
		cwd: "/Users/someone/pergamon-labs",
		question: "Move the discovery agent to the nightly schedule?",
	}),
];

/** The conversation on screen: THREE of the fleet's eleven, all its own. */
const SESSION_ROWS = FLEET_ROWS.filter((row) => row.session_id === MINERVA);

/**
 * What `/v1/desktop/asks` answers, installed on the bridge the app itself uses.
 *
 * INSTALLED DURING THE FIRST RENDER, NOT IN AN EFFECT, and that is the difference
 * between a frame that shows the surface and one that shows an empty sidebar:
 * React runs a CHILD's effects before its parent's, so the query this bridge
 * serves (`SidebarNavigation`, a child) subscribes and issues its first request
 * before a parent effect could install anything - the read fails, and the frame
 * taken in that window carries no `Asks` row at all. The effect-shaped version
 * was a race that the first capture of this set actually lost. The cleanup still
 * runs as an effect, because unmount is a commit-shaped event.
 */
const useAsksBridge = (rows: readonly unknown[] = FLEET_ROWS) => {
	const previous = useRef<unknown>(undefined);
	if (previous.current === undefined) {
		previous.current = window.api?.desktop ?? null;
		const bridge = window as unknown as {
			api?: { desktop?: { request?: (request: BridgeRequest) => unknown } };
		};
		if (!bridge.api) bridge.api = {};
		bridge.api.desktop = {
			request: async (request: BridgeRequest) =>
				request.op === "asks.list"
					? ok({ asks: rows })
					: ({ status: 404, body: { detail: "not found" } } as DesktopResponse),
		};
	}
	useEffect(() => {
		return () => {
			const bridge = window as unknown as {
				api?: { desktop?: unknown };
			};
			if (!bridge.api) return;
			bridge.api.desktop = previous.current ?? undefined;
		};
	}, []);
};

/**
 * THE CATALOGUE ON DISK. The fleet drawer names a card from the same store the
 * sessions list reads, so a story that did not seed it would photograph the
 * fallback for every row and prove nothing about the title rule.
 */
const useCatalogue = (
	rows: readonly {
		session_id: string;
		title?: string | null;
		cwd?: string | null;
	}[] = CATALOGUE,
) => {
	useEffect(() => {
		const before = useCanonicalSessionsStore.getState().sessions;
		useCanonicalSessionsStore.setState({ sessions: [...rows] });
		return () => {
			useCanonicalSessionsStore.setState({ sessions: before });
		};
	}, [rows]);
};

/**
 * A STAND-IN for the conversation column, not a claim about it: this story's
 * subject is the right slot, and an empty column makes it hard to see that the
 * pane DOCKS beside the conversation rather than covering it. It draws the
 * conversation's ground and a few blocks - no transcript components, no fixtures
 * pretending to be a session.
 */
const ConversationStandIn = () => (
	<div className="flex h-full min-w-0 grow flex-col gap-3 overflow-hidden bg-canvas p-6">
		{[72, 260, 320, 180, 300, 140].map((w) => (
			<div key={w} className="h-4 rounded-md bg-sunken" style={{ width: w }} />
		))}
	</div>
);

/** The same frame the app draws: the shell, with the column and the chat page's slot. */
const AppFrame = ({
	content,
	rows,
	catalogue,
}: {
	content?: ReactNode;
	rows?: readonly unknown[];
	catalogue?: readonly {
		session_id: string;
		title?: string | null;
		cwd?: string | null;
	}[];
}) => {
	useAsksBridge(rows);
	useCatalogue(catalogue);
	useLayoutEffect(() => {
		document.documentElement.dataset.chromePlatform = "darwin";
	}, []);
	/*
	 * A FIXED 1280x800 FRAME, not the tab's own size: the shell's decisions here are
	 * width-dependent (§I's dock/overlay rule, the sidebar's three bands), so a story
	 * that inherited the browser window's dimensions would photograph a different
	 * product on every machine - and the frames are evidence, so they have to be
	 * reproducible and comparable.
	 */
	return (
		<div
			className="relative flex flex-col overflow-hidden bg-canvas"
			style={{ width: 1280, height: 720 }}
		>
			<ChatLayout
				sidebar={<SidebarNavigation />}
				content={
					<main className="flex min-w-0 grow flex-col overflow-hidden">
						<div className="flex h-full min-h-0 w-full overflow-hidden">
							{content ?? <ConversationStandIn />}
						</div>
					</main>
				}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/asks fleet scope",
	parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

/**
 * THE TOP-LEVEL CONTEXT: the conversation header's asks trigger carries the FLEET
 * total (11) and the pane it opens is docked in the shell's own right slot, so the press
 * works on every route. Every card carries the name the sessions list gives its
 * conversation - the title from the catalogue, not the directory basename
 * (design review round 1, D1).
 */
export const FleetScopeOpen: Story = {
	render: () => {
		useEffect(() => {
			useUiPreferencesStore.setState({
				isAskDrawerOpen: true,
				askDrawerScope: "fleet",
			});
			return () => {
				useUiPreferencesStore.setState({ isAskDrawerOpen: false });
			};
		}, []);
		return <AppFrame />;
	},
};

/**
 * TWO CONVERSATIONS IN ONE REPOSITORY, NEITHER OF THEM TITLED - the collision
 * `fleetAskConversationLabels` exists for. The two cards are told apart by the
 * session id's tail rather than printing `pergamon-labs` twice, which is the
 * state in which a reader picks the wrong card (design review round 1, D1).
 */
export const UntitledPairInOneRepo: Story = {
	render: () => {
		useEffect(() => {
			useUiPreferencesStore.setState({
				isAskDrawerOpen: true,
				askDrawerScope: "fleet",
			});
			return () => {
				useUiPreferencesStore.setState({ isAskDrawerOpen: false });
			};
		}, []);
		return (
			<AppFrame
				rows={UNTITLED_PAIR}
				catalogue={[
					{
						session_id: PERGAMON,
						cwd: "/Users/someone/pergamon-labs",
					},
					{
						session_id: PERGAMON_SECOND,
						cwd: "/Users/someone/pergamon-labs",
					},
				]}
			/>
		);
	},
};

/**
 * THE TWO SCOPES AT ONE INSTANT, which is the operator's actual requirement: the
 * same sidebar badge (11, the fleet) beside the two real drawers - the
 * conversation's own (`This conversation · 3`) and the fleet's
 * (`All conversations · 11`). The counts differ because they describe different
 * sets, and the chrome bar is what says so.
 *
 * THIS IS A FIGURE, NOT A SCREEN, AND IT SAYS SO IN ITS OWN NAME (agent review
 * round 1, F3; the operator's ask). One slot holds one pane (`claimRightSlot`), so
 * the product can never draw both drawers at once; the first cut of this story
 * shipped a frame of it under a caption that read like an app state, which is the
 * class of impossibility this workstream exists to remove. Both drawers and the
 * sidebar are the real components at the app's own resolved width - but a reader
 * must not have to discover the composition from a docblock, so the story's name
 * carries it and the evidence set does not include a frame of it.
 */
export const ScopeComparison: Story = {
	name: "Scope comparison (a figure - one slot, two panes is not a product state)",
	render: () => (
		<AppFrame
			content={
				<div className="flex h-full min-w-0 grow items-stretch justify-end gap-4 bg-canvas p-4">
					<PaneSlot width={420} minWidth={360}>
						<AskDrawer
							frontend={{
								asks: SESSION_ROWS,
								asks_open: SESSION_ROWS.length,
								asks_truncated: false,
							}}
							scope="session"
							nowMs={Date.now()}
							onClose={() => undefined}
						/>
					</PaneSlot>
					<PaneSlot width={460} minWidth={380}>
						<FleetAskDrawer onClose={() => undefined} />
					</PaneSlot>
				</div>
			}
		/>
	),
};
