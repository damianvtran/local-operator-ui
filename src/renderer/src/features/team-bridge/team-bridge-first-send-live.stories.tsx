import { queryClient } from "@shared/api/query-client";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TeamBridgePage } from "./team-bridge-page";

/**
 * RETURN TO DRAFT, THROUGH THE PRODUCTION CONTAINER.
 *
 * WHY THIS EXISTS. The `First send` stories render the presentational view with a
 * projection fixture, and their Return to draft is a stub: the failed row lives in
 * the story's own map and stays on screen after the click (design round 2, D17).
 * That frame is not evidence of the recovery. This story mounts the REAL
 * `TeamBridgePage` - its send journal, auth-epoch fences, create coalescing and
 * draft merge - and controls ONLY the preload boundary, the way
 * `team-bridge-auth-owner-proof.stories.tsx` does.
 *
 * WHAT IT IS NOT. Not native Electron and not the hub: nothing leaves the page.
 * `team_bridge.messages.send` always answers 503, so every send fails and the
 * failed row's actions can be driven for real. No message reaches anybody.
 *
 * Driving it: open `Bea` in the People rail, type, send. The row fails; Return
 * to draft moves the text back into the composer and removes the row.
 */
const tenant = "org_first_send_live";
const self = "acct_first_send_live_ada";
const peer = "acct_first_send_live_bea";
const now = "2026-10-28T12:00:00Z";
const reply = (result: unknown) => ({ status: 200, body: { result } });
const person = (account_id: string, display_label: string) => ({
	account_id,
	kind: "human",
	display_label,
	state: "active",
	role: "member",
});

function LiveReturnToDraft() {
	const navigate = useNavigate();
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		const prior = window.api.desktop;
		queryClient.clear();
		let created = 0;
		window.api.desktop = {
			...prior,
			request: (async (request: {
				op: string;
				control?: { operation?: string };
				conversation_id?: string;
				seq?: number;
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
													id: self,
													name: "Ada",
													email: "ada@fixture.invalid",
												},
												identity: {},
											}
										: { memberships: [] },
							},
						});
					case "team_bridge.status":
						return reply({
							capability: 1,
							state: "ready",
							account_id: self,
							tenant_id: tenant,
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
										tenant_id: tenant,
										tenant_name: "Northwind Collective",
										eligible: true,
										endpoint: null,
									},
								],
							},
							consent: null,
							error: null,
						});
					case "team_bridge.conversations.list":
						return reply({ conversations: [] });
					case "team_bridge.directory":
						return reply({
							members: [
								{
									account_id: self,
									display_label: "Ada",
									role: "owner",
									bridge_enabled: true,
									bridge_state: "active",
								},
								{
									account_id: peer,
									display_label: "Bea",
									role: "member",
									bridge_enabled: true,
									bridge_state: "active",
								},
							],
						});
					case "team_bridge.unread":
						return reply({ total: 0, organizations: [], conversations: [] });
					case "team_bridge.messages.list":
						return reply({ messages: [], has_more: false });
					case "team_bridge.conversations.create":
						created += 1;
						return reply({
							id: `bcv_first_send_live_${created}`,
							tenant_id: tenant,
							kind: "dm",
							name: "",
							visibility: "private",
							agent_capable: false,
							status: "open",
							created_by: self,
							last_message_at: now,
							latest_seq: 0,
							members: [person(self, "Ada"), person(peer, "Bea")],
							last_read_seq: 0,
							unread_count: 0,
							muted: false,
						});
					case "team_bridge.messages.send":
						// Every send fails, so the failed row's actions are real.
						return {
							status: 503,
							body: { detail: "fixture: transport refused" },
						};
					case "team_bridge.read":
						return reply({
							conversation_id: request.conversation_id,
							last_read_seq: request.seq ?? 0,
							unread_count: 0,
							muted: false,
						});
					default:
						return reply({});
				}
			}) as typeof prior.request,
		};
		navigate(`/team-bridge?tenant=${tenant}`, { replace: true });
		setReady(true);
		return () => {
			window.api.desktop = prior;
			for (const mutation of queryClient.getMutationCache().getAll())
				mutation.destroy();
			queryClient.clear();
		};
	}, [navigate]);
	return (
		<QueryClientProvider client={queryClient}>
			<div className="flex h-screen flex-col bg-canvas text-ink">
				<div className="min-h-0 flex-1">{ready && <TeamBridgePage />}</div>
			</div>
		</QueryClientProvider>
	);
}

export default {
	title: "Team Bridge/First send (production container)",
	component: LiveReturnToDraft,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LiveReturnToDraft>;
export const ReturnToDraft: StoryObj<typeof LiveReturnToDraft> = {};
