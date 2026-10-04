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
 */

import { AskDrawer } from "@features/chat/components/asks/ask-drawer";
import { FleetAskDrawer } from "@features/chat/components/asks/fleet-ask-drawer";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { PaneSlot } from "@shared/components/common/pane-slot";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useLayoutEffect } from "react";
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

/** What `/v1/desktop/asks` answers, installed on the bridge the app itself uses. */
const useAsksBridge = () => {
	useEffect(() => {
		const bridge = window as unknown as {
			api?: { desktop?: { request?: (request: BridgeRequest) => unknown } };
		};
		if (!bridge.api) bridge.api = {};
		const api = bridge.api;
		const original = api.desktop;
		api.desktop = {
			request: async (request: BridgeRequest) =>
				request.op === "asks.list"
					? ok({ asks: FLEET_ROWS })
					: ({ status: 404, body: { detail: "not found" } } as DesktopResponse),
		};
		return () => {
			api.desktop = original;
		};
	}, []);
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
const AppFrame = ({ content }: { content?: ReactNode }) => {
	useAsksBridge();
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
 * THE TOP-LEVEL CONTEXT: the sidebar's `Asks` row carries the FLEET total (11)
 * and the pane it opens is docked in the shell's own right slot, so the press
 * works on every route. Every card names the conversation it came from.
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
 * THE TWO SCOPES AT ONE INSTANT, which is the operator's actual requirement: the
 * same sidebar badge (11, the fleet) beside the two real drawers - the
 * conversation's own (`This conversation · 3`) and the fleet's
 * (`All conversations · 11`). The counts differ because they describe different
 * sets, and the chrome bar is what says so.
 *
 * This is a COMPARISON FIGURE rather than a screen the app draws (one slot holds
 * one pane, `claimRightSlot`): both drawers, and the sidebar beside them, are the
 * real components at the app's own resolved width.
 */
export const ScopeComparison: Story = {
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
