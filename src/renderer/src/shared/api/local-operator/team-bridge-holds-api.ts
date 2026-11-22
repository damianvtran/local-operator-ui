/**
 * The Team Bridge held-messages wire (local-operator B4b, operator decision
 * a-3f46): `GET /v1/desktop/team-bridge/holds`, the owner's signed
 * `POST …/holds/{id}/deliver|discard`, and (#4662) the bulk
 * `POST …/holds/discard-all` for rows core calls `terminal_discard`.
 *
 * Every answer is PARSED, not cast, and the schemas are deliberately narrow:
 * the list is metadata only by contract, and stripping unknown keys means a
 * future field (or a mistaken body) can never reach a row without a reviewed
 * change here. Fields core adds later are OPTIONAL (`unscreened`, #4212), and
 * `kind` / `hold_code` stay open strings so a new code renders generically
 * instead of failing the whole list.
 */
import { z } from "zod";
import type {
	HoldDiscardAllResult,
	HoldItem,
	HoldProof,
	HoldReceipt,
	HoldWord,
	HoldsPage,
} from "../../../features/team-bridge/team-bridge-holds-model";
import { desktopResult } from "./desktop-api";

const str = z.string().nullable();
const SHA256_HEX = /^[0-9a-f]{64}$/;

const holdItem = z.object({
	message_id: z.string(),
	conversation_id: z.string(),
	seq: z.number().int().nullable(),
	held_at: str,
	kind: z.string(),
	hold_code: z.string(),
	releasable: z.boolean(),
	can_deliver: z.boolean(),
	can_discard: z.boolean(),
	deliver_until: str,
	decision: z
		.object({
			word: str,
			decided_at: str,
			outcome: z.string(),
			key_id: str,
		})
		.nullable(),
	unscreened: z.boolean().optional(),
	/*
	 * local-operator #4358, both optional so an older core still parses:
	 * `actionable` is core's ONE "the person owes this an answer" predicate,
	 * which the badge, the nav and the section all count from; `discard_receipt`
	 * binds the local hold record for a Discard when the body can no longer be
	 * loaded. A receipt that is not lowercase sha256 hex reads as absent rather
	 * than failing the whole list: the safe reading of a bad receipt is "no
	 * receipt Discard", and the daemon re-checks any receipt it is sent.
	 */
	actionable: z.boolean().optional(),
	discard_receipt: z
		.string()
		.nullable()
		.optional()
		.transform((value) =>
			typeof value === "string" && SHA256_HEX.test(value) ? value : null,
		),
	/*
	 * local-operator #4662, both optional so an older core still parses and a row
	 * without them behaves exactly as it did before: `terminal_discard` is core's
	 * own "this can be discarded with no proof", and `undeliverable_reason` says
	 * why. An unrecognised reason reads as null rather than failing the WHOLE
	 * list — the same open-set rule `hold_code` follows, because a new reason must
	 * degrade one row's sentence, never empty the section.
	 */
	terminal_discard: z.boolean().optional(),
	undeliverable_reason: z
		.enum(["no_decision_record", "decision_cleared", "payload_expired"])
		.nullable()
		.optional()
		.catch(null),
});

const holdsPage = z.object({
	enabled: z.boolean(),
	key_protection: str.optional().transform((value) => value ?? null),
	items: z.array(holdItem),
});

const receipt = z.object({
	message_id: str,
	state: z.string(),
	decided_at: str,
});

/* #4662: the bulk terminal sweep's own accounting. Counts only, non-negative
   integers: a malformed answer is a failed call rather than an invented report. */
const discardAllResult = z.object({
	discarded: z.number().int().nonnegative(),
	already: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
});

/** The list parse, exported so the wire test runs the shipped schema. */
export function parseHoldsPage(value: unknown): HoldsPage {
	return holdsPage.parse(value) satisfies { items: HoldItem[] };
}

export const TeamBridgeHoldsApi = {
	async list(accountId: string): Promise<HoldsPage> {
		return parseHoldsPage(
			await desktopResult<unknown>({
				op: "team_bridge.holds.list",
				expected_account_id: accountId,
			}),
		);
	},
	async decide(
		accountId: string,
		word: HoldWord,
		item: {
			message_id: string;
			conversation_id: string;
			/** #4662: core's terminal flag, so a bare discard cannot be invented. */
			terminal_discard?: boolean;
		},
		proof: HoldProof,
	): Promise<HoldReceipt> {
		const target = {
			expected_account_id: accountId,
			message_id: item.message_id,
			conversation_id: item.conversation_id,
		};
		/* Deliver only ever carries the shown body's hash: the contract has no
		   receipt field on Deliver, and a receipt proof for it is refused here
		   too, before IPC (S-11). */
		if (word === "deliver") {
			if (!("body_sha256" in proof))
				throw new Error("A Deliver must bind the shown body."); // i18n: ignore programming-error diagnostic, never shown
			return receipt.parse(
				await desktopResult<unknown>({
					op: "team_bridge.holds.deliver",
					...target,
					body_sha256: proof.body_sha256,
				}),
			);
		}
		/* #4662: a terminal row is discarded with NO proof — the route's empty body.
		   Refused here, before IPC, for any row core did not mark, so a bug upstream
		   can never spend a proof-less irreversible discard on a deliverable row. */
		const proofFields =
			"hold_receipt" in proof
				? { hold_receipt: proof.hold_receipt }
				: "body_sha256" in proof
					? { body_sha256: proof.body_sha256 }
					: null;
		if (proofFields === null && item.terminal_discard !== true)
			throw new Error("Only a terminal hold may be discarded without a proof."); // i18n: ignore programming-error diagnostic, never shown
		return receipt.parse(
			await desktopResult<unknown>({
				op: "team_bridge.holds.discard",
				...target,
				...(proofFields ?? {}),
			}),
		);
	},
	/*
	 * #4662: discard EVERY hold core already knows can never be delivered, in one
	 * request, with no per-row proof. Idempotent on the daemon side, so a second
	 * press reports `already` rather than failing. It cannot touch a deliverable
	 * row: the scope is the closed literal `undeliverable`, and the daemon decides
	 * from its own record which rows are in it.
	 */
	async discardAll(accountId: string): Promise<HoldDiscardAllResult> {
		return discardAllResult.parse(
			await desktopResult<unknown>({
				op: "team_bridge.holds.discard_all",
				expected_account_id: accountId,
				scope: "undeliverable",
			}),
		);
	},
};
