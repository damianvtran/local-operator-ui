import { useMemo } from "react";
import type { TeamBridgeMessage } from "../../../../../shared/team-bridge-contract";
import { useMentionSource } from "./mention-context";
import { type MessageMentionRun, messageMentionSpec } from "./message-mentions";

/**
 * The mention runs to highlight in one message body, or undefined.
 *
 * Reads `message.mentions` when the hub sends it and falls back to `@Name`
 * matching otherwise (see `message-mentions.ts` for why both exist). Outside a
 * mention source (stories, the owner audit) it returns undefined, so the body
 * renders exactly as before.
 */
export function useMessageMentions(
	message: Pick<TeamBridgeMessage, "body"> & { mentions?: unknown },
): readonly MessageMentionRun[] | undefined {
	const source = useMentionSource();
	return useMemo(() => {
		if (!source) return undefined;
		return messageMentionSpec({
			body: message.body,
			mentions: message.mentions,
			candidates: source.candidates,
			self: source.self,
		})?.runs;
	}, [source, message.body, message.mentions]);
}
