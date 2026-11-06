import { radientUserKeys } from "@shared/hooks/radient-account-authority";
import type { Meta, StoryObj } from "@storybook/react";
import {
	QueryClient,
	QueryClientProvider,
	type QueryClient as QueryClientType,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { OwnerAuditConversation } from "../../../../shared/team-bridge-owner-audit-contract";
import { teamBridgeKeys } from "./team-bridge-keys";
import { useOwnerAuditSurface } from "./team-bridge-owner-audit";

/**
 * THE READ FENCE, SEEN RATHER THAN ASSERTED: the owner-audit rail in the state
 * that used to be permanently broken, and in the state that must stay refused.
 *
 * WHY THIS STORY. `readForBridgeOwner` refuses a private read whose authority
 * changed while it was out. It used to compare the cached status OBJECT, so the
 * status query's focus refetch — a fresh object carrying the same account,
 * readiness, read-only posture and local availability — tripped the fence on a
 * read that crossed no authority change. The audit queries run `retry: false`
 * with `gcTime: 0` by design, so that one false trip stayed on screen as
 * "Audited messages could not be loaded." for the rest of the session.
 *
 * The fix is not visible in a still by itself, which is exactly why the rig is
 * here: the two stories differ ONLY in what the status refetch does mid-read.
 * "Content-only refetch" must show rows; "genuine authority change" must show
 * the error. A reviewer can flip between them and see that the fence still
 * refuses a real change instead of having been removed.
 *
 * WHAT THIS IS NOT: no backend, hub, runtime or Electron main. The desktop
 * transport is a stand-in on `window.api`, and the two authority rows are
 * seeded into this story's own query client. The behaviour is pinned by
 * `scripts/team-bridge-owner-fence.test.mjs` and
 * `scripts/team-bridge-owner-audit-render.test.mjs`; this file exists so the
 * result can be LOOKED at, and it talks to nothing.
 */

const OWNER = "acct_9f4c1e2d3a4b";
const AGENT = "acct_5b8e0c7a1d23";
const TENANT = "org_a1b2c3";
const AGENT_LABEL = "Aida";

const conversation = (
	id: string,
	kind: string,
	name: string | null,
): OwnerAuditConversation => ({
	id,
	tenant_id: TENANT,
	kind,
	name,
	topic: null,
	visibility: "private",
	status: "active",
	builtin: null,
	last_message_at: "2026-10-23T11:02:41Z",
	latest_seq: 12,
	last_thread_root_id: null,
	members: [
		{
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Okafor",
			role: "member",
			state: "active",
			joined_seq: 0,
			notify: "all",
		},
	],
	member_count: 2,
	viewers: [
		{
			account_id: OWNER,
			display_label: "Damian Tran",
			reason: "agent_owner",
			agent_member_key: `a:bep_${AGENT}`,
		},
	],
	agent: {
		account_id: AGENT,
		display_label: AGENT_LABEL,
		state: "active",
		joined_seq: 1,
	},
});

const page = {
	conversations: [
		conversation("bconv_dm_ben", "dm", null),
		conversation("bconv_group_q4", "group", "Q4 planning"),
	],
	next_cursor: null,
	has_more: false,
};

/* The status payload the app holds for this owner. Only the four authority
 * fields matter to the fence; `state_note` stands for the server prose (or a
 * rotated session id) that a refetch legitimately changes without changing
 * authority. */
const status = (stateNote: string) => ({
	account_id: OWNER,
	tenant_id: TENANT,
	state: "ready",
	surface_state: "C",
	read_only: false,
	local: { enabled: true, onboarding: "done", session: "sess_1" },
	state_note: stateNote,
});

function Harness() {
	const surface = useOwnerAuditSurface({
		accountId: OWNER,
		enabled: true,
		scopeKey: "fence-proof",
		organizations: [{ tenantId: TENANT, name: "Minerva" }],
		onSelect: () => {},
	});
	return <div className="w-80 p-3">{surface?.rail(() => {})}</div>;
}

/**
 * Install the stand-in transport and the authority rows BEFORE the rail mounts
 * (a state initializer runs during the first render), then put the previous
 * transport back on unmount so walking off this story cannot leave a fake
 * behind for another.
 */
function FenceProof({ authorityChange }: { authorityChange: boolean }) {
	const [rig] = useState(() => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		client.setQueryData(radientUserKeys.user(), {
			account: { id: OWNER, email: "damian@gominerva.com" },
		});
		client.setQueryData(teamBridgeKeys.statusFor(OWNER), status("runtime ok"));
		const prior = window.api.desktop;
		window.api.desktop = {
			...prior,
			request: async (request: { op: string }) => {
				if (request.op === "team_bridge.owner_audit.conversations") {
					/* The status refetch, landing while the audit read is out. Identical
					 * authority in both stories; only the state field differs. */
					client.setQueryData(
						teamBridgeKeys.statusFor(OWNER),
						authorityChange
							? { ...status("runtime ok"), state: "unavailable" }
							: status("runtime restarted"),
					);
				}
				return {
					status: 200,
					body: { status: 200, message: "OK", result: page },
				};
			},
		};
		return { client: client as QueryClientType, prior };
	});
	useEffect(
		() => () => {
			window.api.desktop = rig.prior;
		},
		[rig],
	);
	return (
		<QueryClientProvider client={rig.client}>
			<Harness />
		</QueryClientProvider>
	);
}

const meta = {
	title: "Team Bridge/Owner audit fence",
	parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The regression: a content-only status refetch mid-read. Rows, not the error. */
export const ContentOnlyRefetch: Story = {
	render: () => <FenceProof authorityChange={false} />,
};

/** The fence's purpose, unchanged: a genuine authority change still refuses. */
export const GenuineAuthorityChange: Story = {
	render: () => <FenceProof authorityChange />,
};
