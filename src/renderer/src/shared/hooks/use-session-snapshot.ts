/**
 * A quick-send surface's one-shot read of a session's canonical snapshot.
 *
 * WHY THIS IS ONE HOOK AND NOT TWO COPIES. The mini quick-send popup and the
 * project view's quick-send strip both mount the shared composer on a host that
 * has no stream: the composer's readings strip, its cwd chip and its steer
 * decision all read a `CanonicalFrontendState`, and neither host subscribes to
 * the canonical stream (the mini document exists to avoid that stack, and the
 * project strip is a control on a page, not a conversation). Both therefore ask
 * `sessions.get` for the SAME projection the stream's bootstrap frame carries
 * (`SessionSnapshot.payload.frontend`) and hand it to the composer — and the
 * shape was carried in the mini alone until the strip needed it too. Two
 * hand-written copies of one wire read is the drift this module exists to stop:
 * a field added to the snapshot, or a second read the composer grows to need,
 * would be fixed in whichever file the next author happened to open.
 *
 * ONE-SHOT BY DESIGN, AT A CALLER'S CADENCE. There is no subscription here and
 * none is offered: the hosts call `refresh` where they know the reading changes
 * (a summon, a target change, the settle after a send), which is a measured
 * cadence rather than a per-frame one. A refresh that fails leaves the last
 * readings in place — the composer's absent strip is an honest state, and a
 * send never depends on this read.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCallback, useState } from "react";
import type {
	CanonicalFrontendState,
	CanonicalFrontendSync,
} from "../../../../shared/desktop-session-contract";

/**
 * `sessions.get` as this read consumes it: the receipt-shaped frame whose
 * `payload.frontend` is the canonical sync the chat's stream paints. Typed to
 * the two fields read, so a contract change that moves the snapshot shows up
 * here rather than as an undefined at the composer.
 */
type SessionGetReply = {
	payload: {
		frontend: CanonicalFrontendSync;
		cold: boolean;
	};
};

export type SessionSnapshotRead = {
	/** The session's canonical snapshot, or null until a read answers. */
	frontend: CanonicalFrontendState | null;
	/** The rungs `/effort` accepts for this session; absent until a read answers. */
	effortEntities: readonly unknown[] | undefined;
	/** Ask the backend again for this session's readings. */
	refresh: (sessionId: string) => Promise<void>;
};

export function useSessionSnapshot(): SessionSnapshotRead {
	const [frontend, setFrontend] = useState<CanonicalFrontendState | null>(null);
	const [effortEntities, setEffortEntities] = useState<
		readonly unknown[] | undefined
	>(undefined);

	const refresh = useCallback(async (sessionId: string) => {
		try {
			const reply = await desktopResult<SessionGetReply>({
				op: "sessions.get",
				sessionId,
			});
			setFrontend(reply.payload.frontend.snapshot);
		} catch {
			/* A read that failed leaves the last readings (or none); the strip's
			   absent state is honest and nothing sends from this value. */
		}
		try {
			const payload = await desktopResult<{ entities: unknown[] }>({
				op: "commands.entities",
				sessionId,
				command: "effort",
			});
			setEffortEntities(payload.entities);
		} catch {
			/* Same rule: the strip's effort chip without rungs is a label. */
		}
	}, []);

	return { frontend, effortEntities, refresh };
}
