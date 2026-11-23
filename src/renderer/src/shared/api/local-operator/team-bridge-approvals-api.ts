/**
 * The Team Bridge approvals wire (local-operator #4099): pending requests, the
 * two-step presence-confirmed batch decide, and the decision ledger.
 *
 * Every answer is PARSED, not cast: the rows are rendered next to a Touch ID
 * prompt, so a field the daemon did not send must fail the read rather than
 * render as something it is not. The schemas are deliberately narrow - only the
 * reference fields `approvals.request_rows` / `ledger_rows` project - and do not
 * pass unknown keys through, so a future body field can never reach a row.
 */
import { z } from "zod";
import type {
	ApprovalDecideResult,
	ApprovalDecisionRow,
	ApprovalRequestsPage,
	ApprovalSelectionItem,
} from "../../../features/team-bridge/team-bridge-approvals-model";
import { desktopResult } from "./desktop-api";

const str = z.string().nullable();
const word = z.enum(["approve", "deny"]);

const requestRow = z.object({
	message_id: z.string(),
	thread_id: str,
	created_at: str,
	excerpt: str,
	request: z.object({ state: str, expires_at: str }),
	sender: z.object({
		account_id: str,
		endpoint_id: str,
		name: str,
		email: str,
	}),
	ask: z
		.object({ session_id: z.string(), ask_id: z.string(), status: z.string() })
		.nullable(),
	decidable: z.boolean(),
	unsent_decision: word.nullable(),
});

const requestsPage = z.object({
	tenant_id: z.string(),
	items: z.array(requestRow),
	pending_count: z.number().int().nonnegative(),
	next_cursor: str,
	has_more: z.boolean(),
});

const person = z.object({ account_id: str, name: str, email: str });
const decisionsPage = z.object({
	tenant_id: z.string(),
	role: z.enum(["made", "requested"]),
	items: z.array(
		z.object({
			request_id: z.string(),
			thread_id: str,
			decision: str,
			decided_at: str,
			requested_by: person,
			decided_by: person,
			decided_via_claimed: str,
			ask_id: str,
		}),
	),
	next_cursor: str,
});

const operatorProof = z.object({
	challenge: z.string(),
	sig: z.string(),
	key_id: z.string(),
});
const authorizeReply = z.object({
	operator_proof: operatorProof,
	selection_digest: z.string(),
	expires_s: z.number(),
});
const decideReply = z.object({
	results: z.array(
		z.object({
			message_id: z.string(),
			decision: word,
			sent: z.boolean(),
			ask_settled: z.boolean(),
			status: z.string().optional(),
			error: z.string().optional(),
		}),
	),
});

export type ApprovalOperatorProof = z.infer<typeof operatorProof>;

export const TeamBridgeApprovalsApi = {
	async requests(accountId: string): Promise<ApprovalRequestsPage> {
		return requestsPage.parse(
			await desktopResult<unknown>({
				op: "team_bridge.requests.list",
				expected_account_id: accountId,
				limit: 100,
			}),
		);
	},
	async decisions(accountId: string): Promise<ApprovalDecisionRow[]> {
		return decisionsPage.parse(
			await desktopResult<unknown>({
				op: "team_bridge.decisions.list",
				expected_account_id: accountId,
				role: "made",
				limit: 50,
			}),
		).items;
	},
	/** Raises Touch ID in the daemon; resolves when the person answers it. */
	async authorize(
		accountId: string,
		items: ApprovalSelectionItem[],
		clientRef: string,
	) {
		return authorizeReply.parse(
			await desktopResult<unknown>({
				op: "team_bridge.requests.authorize",
				expected_account_id: accountId,
				items,
				client_ref: clientRef,
			}),
		);
	},
	async decide(
		accountId: string,
		items: ApprovalSelectionItem[],
		proof: ApprovalOperatorProof,
	): Promise<ApprovalDecideResult[]> {
		return decideReply.parse(
			await desktopResult<unknown>({
				op: "team_bridge.requests.decide",
				expected_account_id: accountId,
				items,
				operator_proof: proof,
			}),
		).results;
	},
};
