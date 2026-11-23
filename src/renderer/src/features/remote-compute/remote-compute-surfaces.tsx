/**
 * The second level, mounted OUTSIDE the device menu's content.
 *
 * WHY IT IS NOT THE ROW'S CHILD (UX round 1, U1 / QA Q-001). `RemoteComputePicker`
 * rendered `RemoteComputeSheet` and `RemoteRunsDialog` inside Radix's
 * `DropdownMenuContent`, and the primitive unmounts its content on any select - so
 * pressing the row closed the menu and destroyed the sheet's `open` state in the same
 * gesture. Measured on the real app: 0 mounts of `[data-radient-sheet]`, 0 dialogs,
 * no error, focus back on the chip - for the pointer and the keyboard alike. The
 * whole sheet, every refusal remedy and the runs list were unreachable through the
 * product. The peer flow's confirmation survives the same close only because
 * `MoveConfirmDialog` is a SIBLING of the picker, and this file is that arrangement
 * for the rented-capacity family: the surfaces live beside the header, the row only
 * ASKS for them.
 *
 * WHY IT TAKES THE SURFACE AS A PROP. Which second level is open is one value, and
 * two booleans would let both be open at once (`View runs` moves from one to the
 * other, and the sheet's close has to leave neither behind).
 *
 * WHAT IT READS, AND WHY HERE. The prompt is the composer's own text for this pane
 * (`identity` is the key the composer stores by, so the sheet summarises exactly what
 * `remoteRunStart` will send); the directory is resolved by the caller from the pane
 * it belongs to. Neither is state this file owns, and neither is re-derived.
 *
 * THE READ IS THE SAME QUERY KEY THE PICKER USED, so a sheet opened from a row that
 * just answered does not re-ask, and closing both surfaces stops the poll rather than
 * leaving a background read behind every conversation.
 */

import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { FC } from "react";
import { RemoteComputeSheet } from "./remote-compute-sheet";
import {
	REMOTE_COMPUTE_OPEN_POLL_MS,
	useRemoteComputeRead,
} from "./remote-compute-store";
import type { RemoteRun } from "./remote-compute-types";
import { RemoteRunsDialog } from "./remote-runs-list";

/** Which second level is on screen. One value, so both can never be open. */
export type RemoteComputeSurface = "none" | "sheet" | "list";

export type RemoteComputeSurfacesProps = {
	surface: RemoteComputeSurface;
	onSurfaceChange: (surface: RemoteComputeSurface) => void;
	/** The pane's identity, from `panelIdentityFor`: the composer's own key. */
	identity: string;
	/** The directory this pane's run would start in, resolved by the caller. */
	directory: string;
	/** Pins the created run's card, once the server answers with it. */
	onSubmitted: (run: RemoteRun) => void;
};

export const RemoteComputeSurfaces: FC<RemoteComputeSurfacesProps> = ({
	surface,
	onSurfaceChange,
	identity,
	directory,
	onSubmitted,
}) => {
	const read = useRemoteComputeRead(surface !== "none", {
		pollMs: REMOTE_COMPUTE_OPEN_POLL_MS,
	});
	const prompt = useConversationInputStore(
		(state) => state.inputByConversation[identity]?.currentInput ?? "",
	);
	const value = read.data;
	/*
	 * NOTHING TO DRAW BEFORE THE FIRST ANSWER, and the sheet's own model needs that
	 * answer (its network list, its tiers, its account). The row that asked for this
	 * surface was drawn from the same read, so the wait is the shared entry's, not a
	 * second round trip.
	 */
	if (!value) return null;
	return (
		<>
			<RemoteComputeSheet
				open={surface === "sheet"}
				onOpenChange={(open) => onSurfaceChange(open ? "sheet" : "none")}
				read={value}
				prompt={prompt}
				directory={directory}
				onSubmitted={onSubmitted}
				onViewRuns={() => onSurfaceChange("list")}
			/>
			<RemoteRunsDialog
				open={surface === "list"}
				onOpenChange={(open) => onSurfaceChange(open ? "list" : "none")}
				enabled={value.enabled}
				networkName={(networkId) =>
					networkId
						? (value.networks.find((row) => row.network_id === networkId)
								?.name ?? null)
						: null
				}
			/>
		</>
	);
};
