/**
 * Radient's group in the chat's device picker: a labelled group, one row, and the
 * press that opens the second level.
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
 * THE GROUP IS NAMED (design round 1, D1). It used to be a bare separator plus one
 * row, which made a rented capacity read as a fourth device under the move heading -
 * and, worse, under the pinned sentence about a copy being deleted. A
 * `DropdownMenuLabel` in the peer headings' own slot says what the group is before
 * its state does.
 *
 * THE SECOND LEVEL IS NOT MOUNTED HERE (UX U1, QA Q-001). `RemoteComputeSheet` and
 * `RemoteRunsDialog` used to be this component's children, i.e. inside Radix's
 * `DropdownMenuContent` - which unmounts on any select, taking the sheet's `open`
 * state with it. Pressing this row closed the menu and opened nothing: the whole
 * sheet, every refusal remedy and the runs list were unreachable through the product.
 * The second level is now composed beside the device picker
 * (`remote-compute-surfaces.tsx`, mounted by `ChatHeaderDevice` the way
 * `MoveConfirmDialog` already is) and this row only ASKS for it.
 *
 * THE STATES ARE `radientRowView`'s (A-G, and the three read states), and this file
 * only paints them. Three rules matter when reading it:
 *
 * - A ROW THAT CANNOT BE PRESSED KEEPS ITS REASON ON SCREEN, in the row's own
 *   REASON LINE (design D2): the amber line `PickerRow` already draws for an
 *   ineligible device, not the right-hand status slot a pressable state uses.
 *   `aria-disabled` rather than the primitive's `disabled` (the convention
 *   `PickerRow` records two files over): the row stays focusable, so a keyboard user
 *   can reach the sentence that explains why it is not offered.
 * - THE REMEDY THIS APP CAN NAME IS SHOWN, NOT HIDDEN IN THE ACCESSIBLE NAME (UX U3).
 *   Creating a network is CLI-only, so state F prints the commands instead of ending
 *   in `create one`, an imperative with nothing behind it.
 * - `Dedicated` IS DRAWN DISABLED ON THE SECOND LEVEL, not hidden. A capability the
 *   product has and this version does not sell is one line saying when; hiding it
 *   makes the app look like it does not know.
 *
 * THE SIGN-IN IS MOUNTED ONLY FOR A PRESS (`RemoteSignIn`'s own note): the hook behind
 * it polls the account read, and this control is on screen for every conversation.
 */

import { Spinner } from "@shared/components/common/spinner";
import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Cloud } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { useNow } from "./remote-compute-clock";
import { type RadientRowView, radientRowView } from "./remote-compute-model";
import {
	REMOTE_COMPUTE_OPEN_POLL_MS,
	remoteComputeKeys,
	useRemoteComputeRead,
} from "./remote-compute-store";
import type { RemoteComputeRead } from "./remote-compute-types";
import { RemoteSignIn } from "./remote-sign-in";

export type RemoteComputePickerProps = {
	/** Opens the second level. The sheet itself is mounted beside the picker. */
	onOpenSheet: () => void;
	/**
	 * This conversation runs on a PEER, so a run started from here has no directory of
	 * its own (agent review round 1, m4).
	 *
	 * The sheet states `directory` as "the directory the run will start in", and the
	 * only path a remote row carries is the one the session runs under ON THAT PEER.
	 * The start is resolved by THIS machine's daemon, so the sheet would either hand
	 * the daemon a path that means nothing here or start the run somewhere the reader
	 * did not choose. The group is therefore absent for this pane rather than wrong:
	 * a row that cannot state where the run starts is not a destination.
	 */
	hostedElsewhere?: boolean;
};

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

/**
 * The group's one row.
 *
 * `onOpenSheet` is a CALLBACK RATHER THAN STATE OWNED HERE, because the state has to
 * outlive this node: Radix unmounts the menu's content on select, and the surface
 * this row opens must not unmount with it (UX U1).
 */
export const RemoteComputePicker: FC<RemoteComputePickerProps> = ({
	onOpenSheet,
	hostedElsewhere = false,
}) => {
	useI18nLocale();
	const queryClient = useQueryClient();
	const narrow = useNarrowWindow();
	/*
	 * A PICKER THAT JUST OPENED ASKS AGAIN, ONCE (UX U2). The mounted popover is the
	 * moment the row's answer decides whether a money action is offered, and the
	 * shared entry may be up to the catalogue's cadence old. Mount IS "opened": Radix
	 * unmounts this subtree when the menu closes.
	 */
	useEffect(() => {
		void queryClient.invalidateQueries({ queryKey: remoteComputeKeys.read });
	}, [queryClient]);
	/*
	 * NOTHING POLLS ONCE THE ANSWER IS `{enabled: false}` (agent review m2). The gate
	 * reads the CACHED answer rather than this hook's own result, because a hook
	 * cannot see its own return value; `getQueryData` is not reactive, but this
	 * component re-renders on every write to the entry, so the next render sees it.
	 */
	const cached = queryClient.getQueryData<RemoteComputeRead>(
		remoteComputeKeys.read,
	);
	const read = useRemoteComputeRead(cached?.enabled !== false, {
		pollMs: REMOTE_COMPUTE_OPEN_POLL_MS,
	});
	const [signingIn, setSigningIn] = useState(false);
	/** A retry this row pressed, in flight: the row says `checking…` (UX U2). */
	const [checking, setChecking] = useState(false);
	/*
	 * THE CLOCK IS A SECOND, not ten (UX U4): the aggregate prints seconds, and a
	 * reading sampled every ten of them lags by up to nine. The row is one line of
	 * text, and it is only mounted while the picker is open.
	 */
	const now = useNow(1_000);
	const view: RadientRowView = radientRowView({
		read: read.isError
			? { state: "failed" }
			: read.data
				? { state: "answered", value: read.data }
				: { state: "loading" },
		now,
		narrow,
	});
	if (view.kind === "hidden" || hostedElsewhere) return null;
	const disabled = view.kind === "network" || view.kind === "not-offered";
	/** What the right-hand slot holds, for the states that are pressable. */
	const status =
		view.kind === "loading" || view.kind === "sign-in" || view.kind === "ready"
			? view.label
			: null;
	/*
	 * A PRESS ON A RETRY KEEPS THE MENU OPEN AND SAYS WHAT IT IS DOING (UX U2). The
	 * press used to close the picker and refetch invisibly, so a user could not tell
	 * whether it had done anything; the row now wears the `checking…` state it already
	 * had until the answer lands.
	 */
	const retry = () => {
		if (checking) return;
		setChecking(true);
		void read.refetch().finally(() => setChecking(false));
	};
	const open = () => {
		if (disabled || signingIn) return;
		if (view.kind === "sign-in") {
			setSigningIn(true);
			return;
		}
		if (view.kind === "capacity") {
			retry();
			return;
		}
		/*
		 * `ready` AND `runs` BOTH LEAD TO THE SECOND LEVEL: a run in flight does not
		 * stop a user starting another, and the aggregate on the row says what is
		 * already spending. `loading` has nothing to open yet, so it asks again.
		 */
		if (view.kind === "ready" || view.kind === "runs") {
			onOpenSheet();
			return;
		}
		void read.refetch();
	};
	const reason =
		!checking &&
		(view.kind === "capacity" ||
			view.kind === "network" ||
			view.kind === "not-offered")
			? view.reason
			: null;
	/* G's reason is not the user's to fix, so it wears the quiet role, not caution. */
	const reasonInk =
		view.kind === "not-offered" ? "text-ink-muted" : "text-warning";
	const shown = checking
		? {
				kind: "loading" as const,
				label: t("ui.chat.remote_compute.row.checking"),
			}
		: { kind: view.kind, label: status };
	return (
		<div data-radient-group="">
			<DropdownMenuSeparator />
			<DropdownMenuLabel className="text-meta text-ink-dim">
				{t("ui.chat.remote_compute.sheet.heading")}
			</DropdownMenuLabel>
			<DropdownMenuItem
				data-radient-row={view.kind}
				data-radient-checking={checking ? "" : undefined}
				aria-disabled={disabled || undefined}
				aria-busy={signingIn || checking || undefined}
				aria-label={view.sentence}
				onSelect={(event) => {
					/*
					 * THE PRIMITIVE CLOSES THE MENU ON SELECT. A disabled row must not
					 * swallow the press *and* close the menu, and a retry must stay open
					 * while it works, so both refuse the default close.
					 */
					if (disabled) {
						event.preventDefault();
						return;
					}
					if (view.kind === "capacity") event.preventDefault();
					open();
				}}
				className={cn(
					"flex-col items-start gap-0.5 py-1.5",
					disabled &&
						"cursor-not-allowed data-[highlighted]:bg-transparent data-[highlighted]:text-ink-muted",
				)}
			>
				<span className="flex w-full items-center gap-2">
					{signingIn || checking ? (
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
					{/*
					 * THE STATE IS NOT THE TRUNCATABLE HALF (design D9). It used to be
					 * `min-w-0 flex-1 truncate` beside a `shrink-0` label, so the longest
					 * state - and every translation longer than English - ellipsised the one
					 * thing that says what the row is. It wraps instead; device rows in this
					 * picker already run two lines.
					 */}
					{view.kind === "runs" && shown.kind === "runs" ? (
						<span
							data-radient-row-label=""
							className="min-w-0 flex-1 text-end text-meta text-ink-dim"
						>
							{view.facts.map((fact, index) => (
								<span key={fact} className="whitespace-nowrap">
									{index > 0 ? (
										<span aria-hidden="true" className="px-1">
											·
										</span>
									) : null}
									{fact}
								</span>
							))}
						</span>
					) : shown.label ? (
						<span
							data-radient-row-label=""
							className="min-w-0 flex-1 text-end text-meta text-ink-dim"
						>
							{shown.label}
						</span>
					) : null}
				</span>
				{reason ? (
					<span
						data-radient-row-reason=""
						className={cn("w-full ps-5.5 text-meta", reasonInk)}
					>
						{reason.map((part, index) => (
							<span key={part}>
								{index > 0 ? (
									<span aria-hidden="true" className="px-1">
										·
									</span>
								) : null}
								{part}
							</span>
						))}
					</span>
				) : null}
				{view.kind === "network" ? (
					<span
						data-radient-row-note=""
						className="w-full ps-5.5 text-meta text-ink-muted"
					>
						{view.note}
					</span>
				) : null}
			</DropdownMenuItem>
			{signingIn ? (
				<RemoteSignIn
					onSettled={() => {
						setSigningIn(false);
						void read.refetch();
					}}
				/>
			) : null}
		</div>
	);
};
