import { COMPOSER_TEXTAREA_SELECTOR } from "@features/chat/composer-field";
import { ownsEscapeOutsideComposer } from "@features/chat/hooks/use-interrupt-on-escape";
import { PanelNotice } from "@features/chat/pickers/panels/panel-states";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { PanelRightClose } from "lucide-react";
import { type FC, useEffect } from "react";

export type SlotPaneNoticeProps = {
	/** The pane's name, as its own bar prints it ("Run details", "Code review"). */
	label: string;
	/** The close control's accessible name and tooltip ("Close run details"). */
	closeLabel: string;
	onClose: () => void;
	/** One sentence: what this pane cannot show, and why. */
	title: string;
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
 * THE BODY IS A `PanelNotice` of kind `empty`: a quiet fact, not a failure - none of
 * these states lost the user anything, and `PanelNotice`'s own contract is that an
 * unread or absent value is `ink-muted`/`ink-dim`, never a warning.
 *
 * ESCAPE CLOSES IT, the rule the run and code review panes both keep (an UNCLAIMED
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
	closeTourTag,
}) => {
	useEffect(() => {
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
	}, [onClose]);

	return (
		<section
			aria-label={label}
			data-slot-pane-notice={kind}
			className={cn("flex h-full flex-col bg-elevated")}
		>
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 px-2",
					"[padding-inline-end:max(0.5rem,var(--chrome-inset-end-pane,var(--chrome-inset-end)))]",
				)}
			>
				<span className={cn("min-w-0 truncate text-meta text-ink-dim")}>
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
			<div className={cn("px-3 py-3")}>
				<PanelNotice kind="empty" text={title} detail={detail} />
			</div>
		</section>
	);
};
