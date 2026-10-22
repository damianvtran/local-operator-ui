import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";

/** Older hubs omit the rollup. A bad timestamp must not hide a valid reply count. */
export function threadSummary(message: TeamBridgeMessage) {
	const count = message.reply_count ?? 0;
	return {
		count,
		participants: (message.reply_participants ?? []).slice(0, 3),
		lastReply:
			message.last_reply_at &&
			Number.isFinite(Date.parse(message.last_reply_at))
				? new Date(message.last_reply_at)
				: null,
	};
}
