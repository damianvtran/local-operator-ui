/**
 * The composer's hold while a conversation moves between devices.
 *
 * WHY THE COMPOSER SAYS ANYTHING AT ALL (design spec §2.4). A move RETIRES the
 * runtime on this side while the handoff runs: the session is being handed to
 * another machine, so a message typed here has nothing to go to. The design's
 * requirement is the composer "held, NOT HIDDEN - a disabled strip that names the
 * reason", and the reason is the one fact a user cannot read off an empty box: the
 * conversation is not here for the next few minutes, it is there.
 *
 * WHY THIS IS A STRIP AND NOT A DISABLED BOX. The box is one control with one
 * focus ring (`message-input.tsx`'s own note), and the app's other standing states
 * sit outboard of it for that reason. This is a statement, not a control: it takes
 * no focus, offers nothing to press, and disappears when the move settles.
 *
 * IT DOES NOT GATE THE SEND, and it does not claim to: the refusal is the
 * backend's (a retired runtime answers `runtime_retiring` and the app's own
 * failure copy states that), so the sentence below is what the ROUTE will do with
 * anything typed here rather than a client-side rule this file forgot to apply.
 */
import type { FC } from "react";
import { moveHoldSentence } from "./chat-device-model";
import { useChatDeviceStore } from "./chat-device-store";

export const ChatDeviceHold: FC<{ sessionId?: string }> = ({ sessionId }) => {
	const move = useChatDeviceStore((state) =>
		sessionId ? state.moves[sessionId] : undefined,
	);
	if (!sessionId || move?.kind !== "moving") return null;
	return (
		/* `data-device-hold` is the strip's stable identity for the evidence rigs. */
		<output data-device-hold="" className="block pb-2">
			<div className="rounded-md border border-hairline bg-sunken px-3 py-2 text-body-sm text-ink-muted">
				{moveHoldSentence(move.name)}
			</div>
		</output>
	);
};
