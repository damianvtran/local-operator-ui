import { queryClient } from "@shared/api/query-client";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { commissionAccountRead } from "@shared/hooks/use-radient-user-query";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { teamBridgeKeys } from "./team-bridge-keys";
import { TeamBridgePage } from "./team-bridge-page";

function ObservedAuth() {
	const auth = useRadientAuth();
	return (
		<output>
			Observed auth: {auth.user?.radientUser.account.id ?? "unresolved"}
		</output>
	);
}

/** Real Page/auth/membership/commissioning and SHIPPED singleton/cache policy.
 * Only the preload is controlled. This is not native-Electron or JWT evidence,
 * and advertised thread/reaction capabilities must remain locally held. */
function AuthOwnerProof() {
	const navigate = useNavigate();
	const [ready, setReady] = useState(false);
	const [, update] = useState(0);
	const [fixture] = useState(() => ({
		account: "acct_a",
		holdStatus: false,
		refuseB: true,
		waiters: new Set<() => void>(),
	}));
	useLayoutEffect(() => {
		const prior = window.api.desktop;
		queryClient.clear();
		const reply = (result: unknown) => ({ status: 200, body: { result } });
		const member = (account_id: string) => ({
			account_id,
			kind: "human",
			display_label: account_id,
			state: "active",
			role: "member",
		});
		window.api.desktop = {
			...prior,
			request: (async (request: {
				op: string;
				control?: { operation?: string };
				conversation_id?: string;
				seq?: number;
				expected_account_id?: string;
			}) => {
				const owner = fixture.account;
				if (request.op === "capabilities")
					return reply({
						desktop_available: true,
						features: {
							radient: 1,
							team_bridge_conversations: 1,
							team_bridge_conversation_owner_guard: 1,
							team_bridge_threads: 1,
							team_bridge_reactions: 1,
						},
					});
				if (request.op === "radient.request")
					return reply({
						data: {
							result:
								request.control?.operation === "account"
									? {
											account: {
												id: owner,
												name: owner,
												email: `${owner}@fixture.invalid`,
											},
											identity: {},
										}
									: { memberships: [] },
						},
					});
				if (request.op === "team_bridge.status") {
					if (fixture.holdStatus)
						await new Promise<void>((resolve) => fixture.waiters.add(resolve));
					return reply({
						capability: 1,
						state: "ready",
						account_id: owner,
						tenant_id: "org_shared",
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
									tenant_id: "org_shared",
									tenant_name: "Shared fixture",
									eligible: true,
									endpoint: null,
								},
							],
						},
						consent: null,
						error: null,
					});
				}
				if (request.op === "team_bridge.conversations.list")
					return reply({
						conversations: [
							{
								id: "bcv_shared",
								tenant_id: "org_shared",
								kind: "group",
								name: "Shared conversation",
								visibility: "private",
								agent_capable: false,
								status: "open",
								created_by: "acct_a",
								latest_seq: 1,
								last_message_at: "2026-10-23T12:00:00Z",
								members: [member("acct_a"), member("acct_b")],
								last_read_seq: 0,
								unread_count: 0,
								muted: false,
							},
						],
					});
				if (request.op === "team_bridge.directory")
					return reply({ members: [] });
				if (request.op === "team_bridge.unread")
					return reply({ total: 0, organizations: [], conversations: [] });
				if (request.op === "team_bridge.messages.list") {
					if (owner === "acct_b" && fixture.refuseB)
						return {
							status: 404,
							body: { detail: "Controlled B history refusal" },
						};
					return reply({
						messages: [
							{
								id: `message_${owner}`,
								conversation_id: "bcv_shared",
								seq: 1,
								sender: {
									account_id: owner,
									kind: "human",
									display_label: owner,
								},
								body:
									owner === "acct_a"
										? "PRIVATE A HISTORY — never show this as B"
										: "B admitted conversation history",
								origin: "human",
								created_at: "2026-10-23T12:00:00Z",
							},
						],
						has_more: false,
					});
				}
				if (request.op === "team_bridge.read")
					return request.expected_account_id === owner
						? reply({
								conversation_id: request.conversation_id,
								last_read_seq: request.seq ?? 0,
								unread_count: 0,
								muted: false,
							})
						: { status: 403, body: { detail: "Controlled owner refusal" } };
				return reply({});
			}) as typeof prior.request,
		};
		navigate("/team-bridge?tenant=org_shared&conversation=bcv_shared", {
			replace: true,
		});
		setReady(true);
		return () => {
			fixture.holdStatus = false;
			for (const release of fixture.waiters) release();
			fixture.waiters.clear();
			window.api.desktop = prior;
			for (const mutation of queryClient.getMutationCache().getAll())
				mutation.destroy();
			queryClient.clear();
		};
	}, [fixture, navigate]);
	const switchAccount = async (account: string, holdStatus: boolean) => {
		fixture.account = account;
		fixture.holdStatus = holdStatus;
		update((value) => value + 1);
		await commissionAccountRead(queryClient);
		void queryClient.invalidateQueries({ queryKey: teamBridgeKeys.status });
		update((value) => value + 1);
	};
	return (
		<QueryClientProvider client={queryClient}>
			<div className="flex h-screen flex-col bg-surface text-ink">
				<div className="flex flex-wrap items-center gap-3 bg-elevated p-3 text-sm">
					<strong>
						Actual auth completion + singleton 600000 ms · controlled preload
					</strong>
					{ready && <ObservedAuth />}
					<button
						type="button"
						onClick={() => void switchAccount("acct_b", true)}
					>
						Sign in as B · hold status
					</button>
					<button
						type="button"
						onClick={() => {
							fixture.holdStatus = false;
							for (const release of fixture.waiters) release();
							fixture.waiters.clear();
							update((value) => value + 1);
						}}
					>
						Release B status
					</button>
					<button
						type="button"
						onClick={() => {
							fixture.refuseB = false;
							void queryClient.invalidateQueries({
								queryKey: teamBridgeKeys.all,
							});
						}}
					>
						Allow B history
					</button>
					<button
						type="button"
						onClick={() => void switchAccount("acct_a", false)}
					>
						Sign in as A
					</button>
				</div>
				<div className="min-h-0 flex-1">{ready && <TeamBridgePage />}</div>
			</div>
		</QueryClientProvider>
	);
}
export default {
	title: "Team Bridge/Actual auth owner proof",
	component: AuthOwnerProof,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AuthOwnerProof>;
export const CurrentReleaseCarrier: StoryObj<typeof AuthOwnerProof> = {};
