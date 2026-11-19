/**
 * The Team Bridge held-messages wire (local-operator B4b, operator decision
 * a-3f46): `GET /v1/desktop/team-bridge/holds` and the owner's signed
 * `POST …/holds/{id}/deliver|discard`.
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
	HoldItem,
	HoldReceipt,
	HoldWord,
	HoldsPage,
} from "../../../features/team-bridge/team-bridge-holds-model";
import { desktopResult } from "./desktop-api";

const str = z.string().nullable();

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
		item: { message_id: string; conversation_id: string },
		bodySha256: string,
	): Promise<HoldReceipt> {
		return receipt.parse(
			await desktopResult<unknown>({
				op:
					word === "deliver"
						? "team_bridge.holds.deliver"
						: "team_bridge.holds.discard",
				expected_account_id: accountId,
				message_id: item.message_id,
				conversation_id: item.conversation_id,
				body_sha256: bodySha256,
			}),
		);
	},
};
