/* First, as in `team-bridge-composer.stories.tsx`: the page's composer reads the
   preload's `window.electron.ipcRenderer`, which Storybook does not provide. */
import "../chat/components/story-electron-shim";
import { queryClient } from "@shared/api/query-client";
import { commissionAccountRead } from "@shared/hooks/use-radient-user-query";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { asTeamBridgeTenantId } from "./team-bridge-model";
import { TeamBridgePage } from "./team-bridge-page";
import {
	SCOPE_PREFERENCE_KEY,
	SESSION_SCOPE_KEY,
} from "./team-bridge-scope-preference";
import { VIEW_MEMORY_KEY, writeViewMemory } from "./team-bridge-view-memory";

/**
 * LEAVE AND RETURN, LIVE: the operator's report ("when switching back to the
 * team bridge, it doesn't remember which channel/message/group etc I had
 * selected and always defaults back to general") as a story a reviewer and a
 * capture rig can drive.
 *
 * The REAL `TeamBridgePage` mounts under a real `<Routes>`, so pressing "Go to
 * chat" unmounts it exactly as the app's router does, and "Back to Team Bridge"
 * mounts a fresh one - which is the transition that used to land on #general.
 * The shipped QueryClient and `localStorage` are kept across it, as in the app;
 * "Restart" also clears the QueryClient, so only `localStorage` survives.
 * Only the desktop preload is controlled (two organizations, each with
 * #general, a channel, a group and a DM). This is not native-Electron evidence.
 *
 * `?reset=1` in the story args wipes the remembered view, for a clean "before".
 */
const now = "2026-11-03T09:00:00Z";
const member = (account_id: string, kind = "human") => ({
	account_id,
	kind,
	display_label:
		account_id === "acct_me" ? "You" : account_id.replace("acct_", ""),
	state: "active",
	role: "member",
});
const row = (
	id: string,
	tenant: string,
	name: string | undefined,
	patch: Record<string, unknown> = {},
) => ({
	id,
	tenant_id: tenant,
	kind: "channel",
	name,
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_me",
	last_message_at: now,
	latest_seq: 3,
	members: [member("acct_me")],
	member: true,
	last_read_seq: 3,
	unread_count: 0,
	muted: false,
	...patch,
});
const ORGS: Record<string, ReturnType<typeof row>[]> = {
	org_minerva: [
		row("gen_minerva", "org_minerva", "general", { builtin: "general" }),
		row("launch", "org_minerva", "launch"),
		row("design", "org_minerva", "Design crew", {
			kind: "group",
			visibility: "private",
		}),
		row("dm_ben", "org_minerva", undefined, {
			kind: "dm",
			visibility: "private",
			members: [member("acct_me"), member("acct_ben")],
		}),
	],
	org_northwind: [
		row("gen_northwind", "org_northwind", "general", { builtin: "general" }),
		row("ops", "org_northwind", "ops"),
	],
};
/*
 * THE OPERATOR'S RAIL (sidebar scroll report: "when I click a channel it
 * scrolls me back to the top"): long enough that groups, DMs, people and the
 * chief of staff all sit below the fold, so a capture can scroll down, click a
 * row there and show whether the rail stayed put.
 */
const LONG_ORGS: Record<string, ReturnType<typeof row>[]> = {
	...ORGS,
	org_minerva: [
		...ORGS.org_minerva,
		...Array.from({ length: 24 }, (_, index) =>
			row(`ch_${index + 1}`, "org_minerva", `project-${index + 1}`),
		),
		row("dm_ada", "org_minerva", undefined, {
			kind: "dm",
			visibility: "private",
			members: [member("acct_me"), member("acct_ada")],
		}),
	],
};
const history = (conversation: string) =>
	Array.from({ length: 24 }, (_, index) => ({
		id: `${conversation}_${index + 1}`,
		conversation_id: conversation,
		seq: index + 1,
		sender: member(index % 2 ? "acct_ben" : "acct_me"),
		body: `${conversation} · message ${index + 1}`,
		origin: "human",
		created_at: now,
	}));

function LeaveAndReturn({
	reset,
	long,
	opening,
}: {
	reset: boolean;
	long?: boolean;
	opening?: "cold" | "remembered" | "ambiguous" | "upgrade";
}) {
	const orgs = long ? LONG_ORGS : ORGS;
	const navigate = useNavigate();
	const [ready, setReady] = useState(false);
	const [generation, setGeneration] = useState(0);
	/* ONCE per story mount, deliberately: `useNavigate()` returns a new function
	   whenever the pathname changes, so listing it re-ran this setup on every
	   "Go to chat" and bounced the page straight back to Team Bridge. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above.
	useLayoutEffect(() => {
		// Seed browser storage, not a fake selection prop: these boards must
		// pass through the real account, status and opening/revalidation path.
		const saved = [
			[localStorage, VIEW_MEMORY_KEY],
			[localStorage, SCOPE_PREFERENCE_KEY],
			[sessionStorage, SESSION_SCOPE_KEY],
		] as const;
		const previous = saved.map(([storage, key]) => storage.getItem(key));
		if (opening) {
			for (const [storage, key] of saved) storage.removeItem(key);
			if (opening === "remembered") {
				localStorage.setItem(
					SCOPE_PREFERENCE_KEY,
					JSON.stringify({ acct_me: "org_northwind" }),
				);
				// The last viewed rail and the explicit switcher pick can differ.
				writeViewMemory(
					localStorage,
					"acct_me",
					asTeamBridgeTenantId("org_minerva"),
					{
						target: { type: "conversation", id: "gen_minerva" },
						tenantId: "org_minerva",
					},
				);
			}
			if (opening === "upgrade") {
				// A legacy automatic home landing wrote view history but no preference.
				writeViewMemory(
					localStorage,
					"acct_me",
					asTeamBridgeTenantId("org_northwind"),
					{
						target: { type: "conversation", id: "gen_northwind" },
						tenantId: "org_northwind",
					},
				);
			}
		} else if (reset) localStorage.removeItem(VIEW_MEMORY_KEY);
		const prior = window.api.desktop;
		queryClient.clear();
		const reply = (result: unknown) => ({ status: 200, body: { result } });
		window.api.desktop = {
			...prior,
			request: (async (request: {
				op: string;
				control?: { operation?: string };
				conversation_id?: string;
				tenant_id?: string;
				scope?: string;
				status?: string;
			}) => {
				switch (request.op) {
					case "capabilities":
						return reply({
							desktop_available: true,
							features: {
								radient: 1,
								team_bridge_conversations: 1,
								team_bridge_conversation_owner_guard: 1,
							},
						});
					case "radient.request":
						return reply({
							data: {
								result:
									request.control?.operation === "account"
										? {
												account: {
													id: "acct_me",
													name: "You",
													email: "me@fixture.invalid",
												},
												identity: {},
											}
										: {
												memberships: opening
													? [
															{
																tenant_id: "org_minerva",
																tenant_name: "Minerva",
																status: "active",
																role: "member",
																is_home: false,
																plan: { status: "active", seats: 8 },
															},
															{
																tenant_id: "org_northwind",
																tenant_name:
																	opening === "ambiguous"
																		? "Northwind"
																		: "Example Organization",
																status: "active",
																role: "owner",
																is_home: true,
																plan: {
																	status:
																		opening === "ambiguous" ? "active" : "none",
																	seats: 0,
																},
															},
														]
													: [],
											},
							},
						});
					case "team_bridge.status":
						return reply({
							capability: 1,
							state: "ready",
							account_id: "acct_me",
							tenant_id: "org_minerva",
							surface_state: "D",
							visibility: {
								settings: true,
								inbox: true,
								account_door: true,
								onboarding: false,
							},
							update_required: false,
							local: { enabled: true, onboarding: "done", session: "present" },
							status: {
								tenants: [
									{
										tenant_id: "org_minerva",
										tenant_name: "Minerva",
										eligible: true,
										endpoint: null,
									},
									{
										tenant_id: "org_northwind",
										tenant_name:
											opening && opening !== "ambiguous"
												? "Example Organization"
												: "Northwind",
										eligible: !opening || opening === "ambiguous",
										endpoint: null,
									},
								],
							},
							consent: null,
							error: null,
						});
					case "team_bridge.conversations.list":
						return reply({
							conversations:
								request.status === "archived"
									? []
									: request.scope === "account"
										? Object.values(orgs).flat()
										: (orgs[request.tenant_id ?? ""] ?? []),
						});
					case "team_bridge.directory":
						return reply({
							members: [
								...["acct_ben", "acct_ada"].map((id) => ({
									account_id: id,
									display_label: id.replace("acct_", ""),
									role: "member",
									bridge_enabled: true,
									bridge_state: "active",
								})),
								/* A chief of staff, so the long rail carries that section. */
								...(long
									? [
											{
												account_id: "acct_ola",
												display_label: "Ola",
												role: "member",
												bridge_enabled: true,
												bridge_state: "active",
												agent: {
													endpoint_id: "bep_ola",
													name: "Aida",
													state: "active",
												},
											},
										]
									: []),
							],
						});
					case "team_bridge.unread":
						return reply({ total: 0, organizations: [], conversations: [] });
					case "team_bridge.messages.list":
						return reply({
							messages: history(request.conversation_id ?? ""),
							has_more: false,
						});
					case "team_bridge.read":
						return reply({
							conversation_id: request.conversation_id,
							last_read_seq: 24,
							unread_count: 0,
							muted: false,
						});
					/* The composer's speech probe reads the hosting provider (the same
					   answer `fixtures/team-bridge-auth-owner-page.mjs` gives). */
					case "config.get":
						return reply({ values: { hosting: "local" } });
					default:
						return reply({});
				}
			}) as typeof prior.request,
		};
		/* Navigated once the router has subscribed (after commit), not here:
		   react-router ignores a navigate() issued during the first layout pass. */
		void commissionAccountRead(queryClient).then(() => {
			setReady(true);
			navigate("/team-bridge", { replace: true });
		});
		return () => {
			window.api.desktop = prior;
			queryClient.clear();
			if (opening)
				for (const [index, [storage, key]] of saved.entries()) {
					const value = previous[index];
					if (value === null) storage.removeItem(key);
					else storage.setItem(key, value);
				}
		};
	}, [reset, long, opening]);
	return (
		<QueryClientProvider client={queryClient}>
			<div className="flex h-screen flex-col bg-surface text-ink">
				<nav className="flex gap-3 bg-elevated p-3 text-sm">
					<button
						type="button"
						data-rig="chat"
						onClick={() => navigate("/chat")}
					>
						Go to chat
					</button>
					<button
						type="button"
						data-rig="bridge"
						onClick={() => navigate("/team-bridge")}
					>
						Back to Team Bridge
					</button>
					<button
						type="button"
						data-rig="restart"
						onClick={() => {
							navigate("/chat");
							sessionStorage.removeItem(SESSION_SCOPE_KEY);
							queryClient.clear();
							setTimeout(() => {
								setGeneration((value) => value + 1);
								navigate("/team-bridge");
							}, 50);
						}}
					>
						Restart (keep only localStorage)
					</button>
					{long && <RailScrollRig />}
				</nav>
				{/* A FLEX COLUMN, as the shell gives the page (see the board in
				    `team-bridge-page.stories.tsx`): in a block slot the page grows to
				    its content and the rail never scrolls at all. */}
				<div className="flex min-h-0 flex-1 flex-col">
					{ready && (
						<Routes>
							<Route
								path="/team-bridge"
								element={<TeamBridgePage key={generation} />}
							/>
							<Route
								path="*"
								element={
									<p data-rig="away" className="p-6 text-ink-muted">
										Chat (Team Bridge is unmounted)
									</p>
								}
							/>
						</Routes>
					)}
				</div>
			</div>
		</QueryClientProvider>
	);
}

/* The rail's viewport, found by its #general row so the rig reads the same
   element before and after the fix (the fix adds no attribute this needs). */
const railViewport = () =>
	document
		.querySelector('[data-conversation-id="gen_minerva"]')
		?.closest<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;

/*
 * The capture rig for `LongRail`. "Scroll rail down" parks the rail the way a
 * reader who scrolled would be - with project-22, a row far below the fold,
 * in the middle of the viewport, so the press that follows lands on painted
 * pixels - and records the parked offset in `data-parked`. The readout prints
 * the rail's live scrollTop, so each still carries its own number.
 */
const PARK_ROW = '[data-conversation-id="ch_22"]';
function RailScrollRig() {
	const [top, setTop] = useState<number | null>(null);
	const [parked, setParked] = useState<number | null>(null);
	/* A press can land before the rail's rows do; the park waits for them. */
	const [park, setPark] = useState(false);
	const parkNow = () => {
		const viewport = railViewport();
		const row = viewport?.querySelector<HTMLElement>(PARK_ROW);
		if (!viewport || !row || viewport.scrollHeight <= viewport.clientHeight)
			return false;
		const offset =
			row.getBoundingClientRect().top -
			viewport.getBoundingClientRect().top +
			viewport.scrollTop;
		viewport.scrollTop = Math.round(offset - viewport.clientHeight / 2);
		setParked(viewport.scrollTop);
		setTop(viewport.scrollTop);
		return true;
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: parkNow reads live DOM only.
	useEffect(() => {
		const timer = setInterval(() => {
			if (park && parkNow()) setPark(false);
			setTop(railViewport()?.scrollTop ?? null);
		}, 100);
		return () => clearInterval(timer);
	}, [park]);
	return (
		<>
			<button
				type="button"
				data-rig="scroll-rail"
				onClick={() => {
					if (!parkNow()) setPark(true);
				}}
			>
				Scroll rail down
			</button>
			<output
				data-rig="rail-scroll-top"
				data-parked={parked ?? undefined}
				className="ms-auto font-mono"
			>
				rail scrollTop: {top === null ? "-" : Math.round(top)}
				{parked === null ? "" : ` (parked at ${parked})`}
			</output>
		</>
	);
}

export default {
	title: "Team Bridge/Leave and return (live flow)",
	component: LeaveAndReturn,
	parameters: { layout: "fullscreen" },
	args: { reset: false },
} satisfies Meta<typeof LeaveAndReturn>;
export const LiveFlow: StoryObj<typeof LeaveAndReturn> = {};
export const ColdOpening: StoryObj<typeof LeaveAndReturn> = {
	args: { opening: "cold" },
};
export const RememberedOpening: StoryObj<typeof LeaveAndReturn> = {
	args: { opening: "remembered" },
};
export const UpgradeOpening: StoryObj<typeof LeaveAndReturn> = {
	args: { opening: "upgrade" },
};
export const AmbiguousOpening: StoryObj<typeof LeaveAndReturn> = {
	args: { opening: "ambiguous" },
};
/**
 * The same live page with a rail longer than the window: scroll the rail down,
 * pick a row below the fold, and the rail must stay where it was.
 */
export const LongRail: StoryObj<typeof LeaveAndReturn> = {
	args: { reset: true, long: true },
};
