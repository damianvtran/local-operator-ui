import settingsFixture from "../../../../../scripts/fixtures/agent-messages-settings.json";
import statusFixture from "../../../../../scripts/fixtures/agent-messages-status.json";
import consent from "../../../../../scripts/fixtures/team-bridge-consent-v2.json";
import type {
	AgentMessagesSettingsResult,
	AgentMessagesStatus,
} from "../../../../shared/agent-messages-contract";
import {
	type DesktopRequest,
	type DesktopResponse,
	desktopEndpoint,
} from "../../../../shared/desktop-contract";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";

export type ContainerAuditEntry = {
	request: DesktopRequest;
	route: ReturnType<typeof desktopEndpoint>;
	response: DesktopResponse;
};

/**
 * D1: mock ONLY the desktop IPC adapter, never TeamBridgeApi, useQuery, the
 * status observer, or the network-owning TeamBridgePage. All shipped parsing,
 * mutations and invalidation therefore run. Unexpected ops fail locally rather
 * than leaking a request into the operator's actual runtime or hub.
 *
 * Source of post-off truth: runtime #2790, client.py:surface_projection and
 * server/routes/desktop_team_bridge.py:status. E has read_only FALSE (only F is
 * readonly there), local.enabled false, inbox/account_door false, can_receive
 * false. It would manufacture a passing composer test to set read_only true.
 * The retained-history READ envelope separately carries read_only=true after
 * local opt-out; it must not silently be substituted for the status contract.
 */
export function createDefaultOnContainerFixture(input: {
	conversation: TeamBridgeConversation;
	messages: TeamBridgeMessage[];
	onEntry: (entry: ContainerAuditEntry) => void;
}) {
	const { conversation, messages, onEntry } = input;
	const status = structuredClone(statusFixture) as AgentMessagesStatus;
	const settings = structuredClone(
		settingsFixture,
	) as AgentMessagesSettingsResult;
	status.account_id = conversation.created_by;
	status.tenant_id = conversation.tenant_id;
	status.surface_state = "C";
	status.local.enabled = true;
	status.read_only = false;
	status.visibility = {
		settings: true,
		inbox: true,
		account_door: true,
		onboarding: false,
	};
	status.default_on = { in_force: true, notice_pending: true };
	status.consent = {
		version: consent.version,
		text: consent.text,
		source: "served",
	};
	status.can_receive = true;
	status.can_decide = false;
	settings.default_on = true;
	settings.settings.tenant_id = conversation.tenant_id;
	settings.settings.consent_version = consent.version;
	settings.settings.consent_required = false;
	if (!settings.endpoint?.consent)
		throw new Error("Fixture requires enrolled endpoint consent");
	settings.endpoint.tenant_id = conversation.tenant_id;
	settings.endpoint.consent.version = consent.version;
	settings.endpoint.consent.consented_via = "default_on";
	status.status = {
		tenants: [
			{
				tenant_id: conversation.tenant_id,
				tenant_name: "Minerva",
				eligible: true,
				endpoint: { id: settings.endpoint.id, state: "active" },
			},
		],
	};
	const audit: ContainerAuditEntry[] = [];
	function answer(request: DesktopRequest, result: unknown, code = 200) {
		const response = {
			status: code,
			body: code === 200 ? { result } : { detail: result },
		};
		const entry = structuredClone({
			request,
			route: desktopEndpoint(request),
			response,
		});
		audit.push(entry);
		onEntry(entry);
		return structuredClone(response);
	}
	return {
		audit,
		async request(request: DesktopRequest): Promise<DesktopResponse> {
			switch (request.op) {
				case "capabilities":
					// Hub-tenant labels are already in status. This isolated story does
					// not advertise the unrelated account/membership proxy capability.
					return answer(request, {
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						features: { team_bridge: 1 },
					});
				case "team_bridge.status":
				case "agent_messages.status":
					return answer(request, status);
				case "agent_messages.settings":
					return answer(request, settings);
				case "agent_messages.settings.put": {
					if (
						request.state !== "disabled" ||
						request.expected_account_id !== status.account_id ||
						request.tenant_id !== status.tenant_id
					) {
						return answer(
							request,
							{
								code: "invalid_request",
								message: "Fixture refuses unexpected settings write", // i18n: ignore story fixture's wire error body, not rendered copy
							},
							422,
						);
					}
					if (!settings.endpoint || !status.status?.tenants[0].endpoint) {
						throw new Error("Fixture endpoint disappeared before disable");
					}
					settings.endpoint.state = "disabled";
					settings.settings.consent_required = true;
					status.surface_state = "E";
					status.local.enabled = false;
					// IMPORTANT: faithful runtime response, NOT the hoped-for UI state.
					status.read_only = false;
					status.can_receive = false;
					status.visibility.inbox = false;
					status.visibility.account_door = false;
					status.status.tenants[0].endpoint.state = "disabled";
					return answer(request, settings);
				}
				case "agent_messages.onboarding.dismiss":
					status.default_on = { in_force: true, notice_pending: false };
					status.local.onboarding = "seen";
					return answer(request, { onboarding: "seen" });
				case "team_bridge.conversations.list":
					return answer(request, {
						conversations: [conversation],
						has_more: false,
					});
				case "team_bridge.conversations.get":
					return answer(request, conversation);
				case "team_bridge.messages.list":
					return answer(request, { messages, has_more: false });
				case "team_bridge.unread":
					return answer(request, {
						total: 0,
						organizations: [
							{
								tenant_id: conversation.tenant_id,
								tenant_name: "Minerva",
								unread: 0,
							},
						],
					});
				case "team_bridge.directory":
					return answer(request, {
						tenant_id: conversation.tenant_id,
						members: [],
					});
				case "team_bridge.read":
					return answer(request, {
						conversation_id: conversation.id,
						last_read_seq: conversation.latest_seq,
						unread_count: 0,
						muted: false,
					});
				default:
					return answer(
						request,
						{
							code: "fixture_unhandled_op",
							message: `No fixture response for ${request.op}`, // i18n: ignore story fixture's wire error body, not rendered copy
						},
						503,
					);
			}
		},
	};
}
