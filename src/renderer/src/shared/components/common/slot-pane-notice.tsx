import { COMPOSER_TEXTAREA_SELECTOR } from "@features/chat/composer-field";
import { ownsEscapeOutsideComposer } from "@features/chat/hooks/use-interrupt-on-escape";
import { PanelNotice } from "@features/chat/pickers/panels/panel-states";
import {
	SLOT_NOTICE_PROGRESS_DELAY_MS,
	type SlotNoticeTone,
} from "@features/chat/right-slot-notices";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { PanelRightClose } from "lucide-react";
import { type FC, useEffect, useState } from "react";

export type SlotPaneNoticeProps = {
	/** The pane's name, as its own bar prints it ("Run details", "Code review"). */
	label: string;
	/** The close control's accessible name and tooltip ("Close run details"). */
	closeLabel: string;
	onClose: () => void;
	/** One sentence: what this pane cannot show, and why. */
	title: string;
	/** How the body reads (`PanelNotice`'s kind); see `SlotNoticeTone`. */
	tone: SlotNoticeTone;
	/**
	 * The label's look, copied from the pane this notice stands in for (design
	 * round 1, D4), so the real pane replacing it neither brightens nor moves the
	 * title: Code review's bar label is `ink-muted`, Run details' roster label is
	 * `ink-dim` with the crumb's `px-1`.
	 */
	labelInk: "muted" | "dim";
	labelInset?: boolean;
	/** One optional clause: what will appear here, or what would change it. */
	detail?: string;
	/**
	 * Which notice this is, on the element (`data-slot-pane-notice`), so a test or
	 * a capture rig can assert the state rather than reading the copy.
	 */
	kind: string;
	/** The close control's `data-tour-tag`, the hook the app's probes read. */
	closeTourTag?: string;
};

/**
 * Close a pane's notice on an UNCLAIMED Escape (see `SlotPaneNotice`'s note for the
 * carve-outs). Exported so the console pane's own draft state - the notice's sibling,
 * opened by a door beside these - closes on the same key by the same rule (UX round
 * 1, U2). `enabled` lets a pane call it unconditionally and arm it only while the
 * notice is what it draws.
 */
export function usePaneNoticeEscape(onClose: () => void, enabled = true): void {
	useEffect(() => {
		if (!enabled) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented) return;
			if (event.isComposing) return;
			if (ownsEscapeOutsideComposer(event.target)) return;
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest(COMPOSER_TEXTAREA_SELECTOR) !== null
			)
				return;
			event.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose, enabled]);
}

/**
 * A right-slot pane that has nothing to show yet, and says why.
 *
 * WHY IT EXISTS (the always-visible rail, D1). Every rail door is present on every
 * chat route, so a door can be pressed where its pane cannot act: Run details on a
 * draft or before the conversation's frame is read, Code review on a draft or on a
 * backend without `features.code_requests`. The press still answers - it opens this,
 * which names the reason - rather than doing nothing or drawing an empty column.
 *
 * THE BAR IS THE CONSOLE'S DRAFT BAR (`console-pane.tsx`), the precedent for exactly
 * this state: the slot's 40px height with no ground of its own, so the pane does not
 * move when the real one replaces it, and a CLOSE control in it, because a pane the
 * user cannot close from inside is a pane they have to find the door for. The corner
 * reservation is the same `--chrome-inset-end-pane` padding every pane toolbar uses
 * (the console's note states why padding and not a spacer).
 *
 * THE BODY IS A `PanelNotice` IN THE NOTICE'S OWN TONE (design round 1, D3): `empty`
 * for a draft or an older server - a quiet fact, nothing lost; `loading` for a read
 * on its way; `unavailable` for a read that failed, at full ink, because that is the
 * line the user has to act on. A progress body waits
 * `SLOT_NOTICE_PROGRESS_DELAY_MS` before it is drawn (UX round 1, U1), so a fast
 * read lands in an empty slot instead of blinking a sentence; the bar - which the
 * real pane draws identically - is there from the first frame.
 *
 * ESCAPE CLOSES IT (`usePaneNoticeEscape`), the rule the run and code review panes both keep (an UNCLAIMED
 * Escape is the open pane's): the doors that open this are those panes' doors, and a
 * door whose pane closed on Escape yesterday must not open one that ignores it
 * today. The carve-outs are the code review pane's: an IME mid-composition, a field
 * that owns Escape, and the composer's textarea - the composer's own Escape belongs
 * to the turn interrupt and the composer, and this notice has nothing to protect
 * that would justify taking it.
 */
export const SlotPaneNotice: FC<SlotPaneNoticeProps> = ({
	label,
	closeLabel,
	onClose,
	title,
	detail,
	kind,
	tone,
	labelInk,
	labelInset = false,
	closeTourTag,
}) => {
	usePaneNoticeEscape(onClose);
	/*
	 * Which progress notice has waited out its delay. Keyed by `kind` rather than a
	 * boolean, so a second progress state never inherits the first one's elapsed
	 * wait and shows without its own.
	 */
	const [elapsedFor, setElapsedFor] = useState<string | null>(null);
	useEffect(() => {
		if (tone !== "loading") return;
		const timer = setTimeout(
			() => setElapsedFor(kind),
			SLOT_NOTICE_PROGRESS_DELAY_MS,
		);
		return () => clearTimeout(timer);
	}, [tone, kind]);
	const bodyShown = tone !== "loading" || elapsedFor === kind;

	return (
		<section
			aria-label={label}
			data-slot-pane-notice={kind}
			/* The session-less state of a rail pane (Run details, Code review): what a
			   user sees first, so it owns the pane's glass alpha like the pane it stands in
			   for (QA round 2, Q2-2: it read 1.00 under Full app). */
			data-glass-region="pane"
			className={cn("flex h-full flex-col bg-elevated")}
		>
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 px-2",
					"[padding-inline-end:max(0.5rem,var(--chrome-inset-end-pane,var(--chrome-inset-end)))]",
				)}
			>
				<span
					className={cn(
						"min-w-0 truncate text-meta",
						labelInk === "muted" ? "text-ink-muted" : "text-ink-dim",
						labelInset && "px-1",
					)}
				>
					{label}
				</span>
				<Tooltip content={closeLabel}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={closeLabel}
						onClick={onClose}
						data-tour-tag={closeTourTag}
					>
						<PanelRightClose aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
			{bodyShown ? (
				<div className={cn("px-3 py-3")} data-slot-pane-notice-body="">
					<PanelNotice kind={tone} text={title} detail={detail} />
				</div>
			) : null}
		</section>
	);
};
