import type { ProfileRevertDescriptor } from "../../../../shared/profile-consent";
import {
	type ProfileRevertIdentity,
	profileRevertAuthority,
	readProfileRevertStatus,
	runProfileRevertPress,
} from "../chat/canonical/profile-revert-status";
/**
 * The SCRIPTED TRANSPORT behind the enabled-affordance story.
 *
 * WHY THIS EXISTS. The Revert control may only be offered from a live status answer
 * for the row's own identity, so a story that set `enabled: true` would photograph a
 * state the product cannot produce. This drives the SHIPPED seam —
 * `readProfileRevertStatus` and `runProfileRevertPress` — with the golden artifact's
 * correlated ACK frames injected as the transport: the enabled state is caused by
 * `agent.available`, and the settled state by `agent.applied`. The write is recorded,
 * never sent.
 *
 * SCRIPTED TRANSPORT — NO BACKEND PROFILE WRITE.
 */
import {
	GOLDEN_APPROVAL_ROWS,
	GOLDEN_LIVE_ACTION_ACK,
	GOLDEN_SAVED_AGENT_TOOL_RESULT,
} from "./profile-action-golden";

/** The artifact's own saved-agent descriptor: action, receipt and profile identity. */
export const SCRIPTED_REVERT_DESCRIPTOR = GOLDEN_SAVED_AGENT_TOOL_RESULT.details
	.profile_action as unknown as ProfileRevertDescriptor;

/** The identity the artifact's frames answer for — every field from the artifact. */
export const SCRIPTED_REVERT_IDENTITY: ProfileRevertIdentity = {
	action_id: SCRIPTED_REVERT_DESCRIPTOR.action_id,
	receipt_id: SCRIPTED_REVERT_DESCRIPTOR.receipt_id,
	profile_kind: SCRIPTED_REVERT_DESCRIPTOR.profile_kind,
	profile_name: SCRIPTED_REVERT_DESCRIPTOR.profile_name,
	tool_call_id: GOLDEN_SAVED_AGENT_TOOL_RESULT.tool_call_id,
};

/** The originating session, from the artifact's own list row. */
export const SCRIPTED_REVERT_SESSION =
	GOLDEN_APPROVAL_ROWS[0].typed_approval.disclosure.session_id;

export type ScriptedRevertSequence = {
	available: Awaited<ReturnType<typeof readProfileRevertStatus>>;
	authority: ReturnType<typeof profileRevertAuthority>;
	settled: Awaited<ReturnType<typeof runProfileRevertPress>>;
	writes: string[];
};

/**
 * THE READ ONLY: what the status seam says about this action, with NO press.
 *
 * This is what the enabled-affordance story mounts on. It must never write, which is
 * the point of splitting it from the sequence below: a mount that pressed would leave
 * the story showing a settled, disabled control instead of the affordance it exists to
 * photograph (review R6-1).
 */
export async function runScriptedAvailabilityRead(): Promise<{
	available: Awaited<ReturnType<typeof readProfileRevertStatus>>;
	authority: ReturnType<typeof profileRevertAuthority>;
	writes: string[];
}> {
	const available = await readProfileRevertStatus(
		SCRIPTED_REVERT_SESSION,
		SCRIPTED_REVERT_IDENTITY,
		async () => GOLDEN_LIVE_ACTION_ACK.agent.available,
	);
	return {
		available,
		authority: profileRevertAuthority(available),
		writes: [],
	};
}

/** Read → press, both through the shipped seam, both from the artifact's frames. */
export async function runScriptedRevertSequence(): Promise<ScriptedRevertSequence> {
	const writes: string[] = [];
	const available = await readProfileRevertStatus(
		SCRIPTED_REVERT_SESSION,
		SCRIPTED_REVERT_IDENTITY,
		async () => GOLDEN_LIVE_ACTION_ACK.agent.available,
	);
	const authority = profileRevertAuthority(available);
	/*
	 * THE PRESS'S OWN ORDER, SCRIPTED: its authorising read answers `available` (the
	 * artifact's stage before the press) and its reconciling read answers `applied`.
	 * Answering `applied` to the FIRST read would — correctly — stop the press before
	 * it wrote anything, since a completion already exists.
	 */
	let reads = 0;
	const settled = await runProfileRevertPress({
		descriptor: SCRIPTED_REVERT_DESCRIPTOR,
		sessionId: SCRIPTED_REVERT_SESSION,
		epoch: "epoch-scripted",
		status: available,
		identity: SCRIPTED_REVERT_IDENTITY,
		write: async (request) => {
			writes.push(request.requestId);
			return {};
		},
		readStatus: async () => {
			reads += 1;
			return reads === 1
				? GOLDEN_LIVE_ACTION_ACK.agent.available
				: GOLDEN_LIVE_ACTION_ACK.agent.applied;
		},
	});
	return { available, authority, settled, writes };
}
