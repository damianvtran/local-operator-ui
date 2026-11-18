/**
 * Radient's group in the chat's device picker: one row, then a second level.
 *
 * WHY IT IS NOT A `PeerRow` AND NOT IN `picker.sections` (design §2.1). A peer row is
 * a typed claim about a DEVICE: an id from the mesh, a reachability probe, a session
 * count, a build the peer advertised. Radient has none of those - it is capacity that
 * is rented, with no device, no membership and no sessions. Putting a synthetic row
 * among the peers would make `session_count` and `reachable` assert things that are
 * not true, and the sidebar groups by peer, so it would file remote work under a
 * device that does not exist. So: same control, two groups, two row types, and a rule
 * between them because they answer different questions.
 *
 * THE STATES ARE `radientRowView`'s (A-G, and the three read states), and this file
 * only paints them. Two rules matter when reading it:
 *
 * - A ROW THAT CANNOT BE PRESSED KEEPS ITS REASON ON SCREEN. `aria-disabled` rather
 *   than the primitive's `disabled` (the convention `PickerRow` records two files
 *   over): the row stays focusable, so a keyboard user can reach the sentence that
 *   explains why it is not offered.
 * - `Dedicated` IS DRAWN DISABLED ON THE SECOND LEVEL, not hidden. A capability the
 *   product has and this version does not sell is one line saying when; hiding it
 *   makes the app look like it does not know.
 *
 * THE SIGN-IN IS MOUNTED ONLY FOR A PRESS (`RemoteSignIn`'s own note): the hook behind
 * it polls the account read, and this control is on screen for every conversation.
 */

import { Spinner } from "@shared/components/common/spinner";
import { DropdownMenuItem, DropdownMenuSeparator } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { Cloud } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { useNow } from "./remote-compute-clock";
import { type RadientRowView, radientRowView } from "./remote-compute-model";
import { RemoteComputeSheet } from "./remote-compute-sheet";
import { useRemoteComputeRead } from "./remote-compute-store";
import type { RemoteRun } from "./remote-compute-types";
import { RemoteRunsDialog } from "./remote-runs-list";
import { RemoteSignIn } from "./remote-sign-in";

/** The design's own breakpoint: below it the aggregate loses its seconds. */
const NARROW_QUERY = "(max-width: 699px)";

/**
 * Whether the window is narrow, from one listener.
 *
 * A WINDOW READING, not a container one: the picker is a fixed 20rem popover, so the
 * thing that actually narrows the aggregate is the window the popover sits in - and
 * this is the same 700px the design names for the composer chip's own truncation.
 */
function useNarrowWindow(): boolean {
	const [narrow, setNarrow] = useState(
		() => typeof window !== "undefined" && window.innerWidth < 700,
	);
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const media = window.matchMedia(NARROW_QUERY);
		const apply = () => setNarrow(media.matches);
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, []);
	return narrow;
}

export type RemoteComputePickerProps = {
	/**
	 * The pane's identity (`panelIdentityFor`): the session id, or a draft's key. The
	 * composer's text is read by this key, INSIDE this node - which mounts only while
	 * the picker is open, so a keystroke re-renders an open popover rather than the
	 * chat header. Subscribing to the raw text one level up is the trap
	 * `chat-page.tsx` records for exactly this field (`composer typing perf`).
	 */
	identity: string;
	/** The directory this conversation would run in, resolved by the caller. */
	directory: string;
	onSubmitted: (run: RemoteRun) => void;
};

/**
 * The group, as one node: the separator, the row, and the two surfaces it can open.
 *
 * The sheet and the list are rendered here and portalled by their own primitives, so
 * this node is safe to place inside the picker's menu content. Selecting the row
 * closes the menu (the primitive's own behaviour) and opening the sheet in the same
 * gesture is what makes the row a destination rather than a toggle.
 */
export const RemoteComputePicker: FC<RemoteComputePickerProps> = ({
	identity,
	directory,
	onSubmitted,
}) => {
	useI18nLocale();
	const narrow = useNarrowWindow();
	const now = useNow(10_000);
	/** What a run would execute: the composer's own text, as typed. */
	const prompt = useConversationInputStore(
		(state) => state.inputByConversation[identity]?.currentInput ?? "",
	);
	/*
	 * THE READ IS THE GATE AND IT IS ASKED WHILE THIS NODE IS MOUNTED, which is only
	 * while the picker is open: Radix unmounts the menu's content when it closes, so a
	 * closed picker costs nothing. The query key is shared with the run card's own read,
	 * so opening a picker beside a card re-uses one entry rather than adding a second.
	 */
	const read = useRemoteComputeRead(true);
	const [sheet, setSheet] = useState(false);
	const [list, setList] = useState(false);
	const [signingIn, setSigningIn] = useState(false);
	const view: RadientRowView = radientRowView({
		read: read.isError
			? { state: "failed" }
			: read.data
				? { state: "answered", value: read.data }
				: { state: "loading" },
		now,
		narrow,
	});
	if (view.kind === "hidden") return null;
	const disabled = view.kind === "network" || view.kind === "not-offered";
	const label =
		view.kind === "capacity" || view.kind === "network"
			? `${view.label} · ${view.why}`
			: view.label;
	const open = () => {
		if (disabled) return;
		if (signingIn) return;
		if (view.kind === "sign-in") {
			setSigningIn(true);
			return;
		}
		if (view.kind === "capacity") {
			void read.refetch();
			return;
		}
		// `ready` and `runs` both lead to the second level: a run in flight does not
		// stop a user starting another, and the aggregate on the row says what is
		// already spending.
		setSheet(true);
	};
	return (
		<>
			<DropdownMenuSeparator />
			<DropdownMenuItem
				data-radient-row={view.kind}
				aria-disabled={disabled || undefined}
				aria-busy={signingIn || undefined}
				aria-label={
					disabled
						? `${t("ui.chat.remote_compute.row.name")}: ${label}`
						: view.sentence
				}
				onSelect={(event) => {
					// The primitive closes the menu on select; a disabled row must not
					// swallow the press *and* nothing else, so it simply returns.
					if (disabled) {
						event.preventDefault();
						return;
					}
					open();
				}}
				className={cn(
					"flex-col items-start gap-0.5 py-1.5",
					disabled &&
						"cursor-not-allowed data-[highlighted]:bg-transparent data-[highlighted]:text-ink-muted",
				)}
			>
				<span className="flex w-full items-center gap-2">
					{signingIn ? (
						<Spinner
							aria-hidden="true"
							className="size-3.5 shrink-0 text-ink-dim"
						/>
					) : (
						<Cloud
							aria-hidden="true"
							className="size-3.5 shrink-0 text-ink-dim"
						/>
					)}
					<span className="shrink-0 text-body-sm text-ink">
						{t("ui.chat.remote_compute.row.name")}
					</span>
					<span
						data-radient-row-label=""
						className="min-w-0 flex-1 truncate text-end text-meta text-ink-dim"
					>
						{label}
					</span>
				</span>
			</DropdownMenuItem>
			{signingIn ? (
				<RemoteSignIn
					onSettled={() => {
						setSigningIn(false);
						void read.refetch();
					}}
				/>
			) : null}
			{read.data ? (
				<>
					<RemoteComputeSheet
						open={sheet}
						onOpenChange={setSheet}
						read={read.data}
						prompt={prompt}
						directory={directory}
						onSubmitted={onSubmitted}
						onViewRuns={() => setList(true)}
					/>
					<RemoteRunsDialog
						open={list}
						onOpenChange={setList}
						enabled={read.data.enabled}
						networkName={(networkId) =>
							networkId
								? (read.data?.networks.find(
										(row) => row.network_id === networkId,
									)?.name ?? null)
								: null
						}
					/>
				</>
			) : null}
		</>
	);
};
