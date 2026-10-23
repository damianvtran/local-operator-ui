import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TeamBridgePage } from "./team-bridge-page";
import { teamBridgeKeys } from "./use-team-bridge";

/** Browser evidence uses the actual container, hooks and API parser, not a
 * PageView/onSend replica. The labelled preload fixture is NOT authentication
 * evidence: independent real-account server QA is a separate release gate. */
function OwnerProof() {
	const navigate = useNavigate();
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: { retry: false, gcTime: 0 },
					mutations: { retry: false, gcTime: 0 },
				},
			}),
	);
	const [fixture] = useState(() => ({
		account: "acct_a",
		tenant: "org_shared",
		enabled: true,
		readOnly: false,
		hold: false,
		release: null as (() => void) | null,
		calls: [] as {
			owner: string;
			op: string;
			body?: string;
			conversation_id?: string;
		}[],
	}));
	const [ready, setReady] = useState(false);
	const [, update] = useState(0);
	const refresh = () => {
		update((value) => value + 1);
		void client.invalidateQueries({ queryKey: teamBridgeKeys.status });
	};
	useLayoutEffect(() => {
		client.setQueryDefaults(["desktop", "capabilities"], {
			staleTime: Number.POSITIVE_INFINITY,
		});
		client.setQueryData(["desktop", "capabilities"], {
			desktop_available: true,
			features: {},
		});
		const prior = window.api.desktop;
		const member = (id: string) => ({
			account_id: id,
			kind: "human",
			display_label: id,
			state: "active",
			role: "member",
		});
		const conversation = (id = "bcv_shared") => ({
			id,
			tenant_id: "org_shared",
			kind: "group",
			name: "Private fixture thread",
			visibility: "private",
			agent_capable: false,
			status: "open",
			created_by: "acct_a",
			latest_seq: 0,
			last_message_at: "2026-10-23T12:00:00Z",
			members: [member("acct_a"), member("acct_b")],
			last_read_seq: 0,
			unread_count: 0,
			muted: false,
		});
		const reply = (result: unknown) => ({ status: 200, body: { result } });
		window.api.desktop = {
			...prior,
			request: (async (request: {
				op: string;
				body?: string;
				conversation_id?: string;
				seq?: number;
			}) => {
				const owner = fixture.account;
				fixture.calls.push({ owner, ...request });
				switch (request.op) {
					case "team_bridge.status":
						return reply({
							capability: 1,
							state: "ready",
							account_id: owner,
							tenant_id: fixture.tenant,
							read_only: fixture.readOnly,
							surface_state: "D",
							visibility: {
								settings: true,
								inbox: true,
								account_door: true,
								onboarding: false,
							},
							update_required: false,
							local: {
								enabled: fixture.enabled,
								onboarding: "done",
								session: "present",
							},
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
					case "team_bridge.conversations.list":
						return reply({ conversations: [conversation()] });
					case "team_bridge.directory":
						return reply({ members: [] });
					case "team_bridge.unread":
						return reply({ total: 0, organizations: [], conversations: [] });
					case "team_bridge.messages.list":
						return reply({ messages: [], has_more: false });
					case "team_bridge.conversations.create":
						return reply(conversation(`created_${owner}`));
					case "team_bridge.messages.send":
						if (fixture.hold) {
							await new Promise<void>((resolve) => {
								fixture.release = resolve;
							});
							return reply({ id: `posted_${owner}` });
						}
						return {
							status: 503,
							body: { detail: "Fixture refused delivery" },
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
		navigate("/team-bridge?tenant=org_shared&conversation=bcv_shared", {
			replace: true,
		});
		setReady(true);
		return () => {
			fixture.release?.();
			window.api.desktop = prior;
			client.clear();
		};
	}, [client, fixture, navigate]);
	return (
		<QueryClientProvider client={client}>
			<div className="flex h-screen flex-col bg-surface text-ink">
				<div className="flex flex-wrap items-center gap-3 bg-elevated p-3 text-sm">
					<strong>
						Production container · transport fixture · {fixture.account} /{" "}
						{fixture.tenant}
					</strong>
					<button
						type="button"
						onClick={() => {
							fixture.account = "acct_a";
							refresh();
						}}
					>
						Account A
					</button>
					<button
						type="button"
						onClick={() => {
							fixture.account = "acct_b";
							refresh();
						}}
					>
						Account B
					</button>
					<button
						type="button"
						onClick={() => {
							fixture.tenant =
								fixture.tenant === "org_shared" ? "org_other" : "org_shared";
							refresh();
						}}
					>
						Switch tenant
					</button>
					<button
						type="button"
						onClick={() => {
							fixture.hold = true;
							update((value) => value + 1);
						}}
					>
						Hold next POST
					</button>
					<button
						type="button"
						onClick={() => {
							fixture.release?.();
							fixture.release = null;
							fixture.hold = false;
							update((value) => value + 1);
						}}
					>
						Release A POST
					</button>
					<button
						type="button"
						onClick={() => {
							fixture.enabled = !fixture.enabled;
							refresh();
						}}
					>
						Toggle opt-out
					</button>
					<span>
						POST receipts:{" "}
						{fixture.calls
							.filter((call) => call.op === "team_bridge.messages.send")
							.map((call) => `${call.owner}:${call.conversation_id}`)
							.join(" | ") || "none"}
					</span>
				</div>
				<div className="min-h-0 flex-1">{ready && <TeamBridgePage />}</div>
			</div>
		</QueryClientProvider>
	);
}

const meta = {
	title: "Team Bridge/Owner boundary proof",
	component: OwnerProof,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof OwnerProof>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ProductionContainer: Story = {};
