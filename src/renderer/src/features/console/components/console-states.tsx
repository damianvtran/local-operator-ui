import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { AlertTriangle, Lock, Plus, SquareTerminal } from "lucide-react";
import type { FC, ReactNode } from "react";

/**
 * The console pane's non-terminal states, and the two banners that sit above its
 * terminal when one is showing history or refusing to record.
 *
 * Design: `docs/design/ui-console-tab.md` 6.1 (empty and loading are the pane's
 * own states, and the `+` control is present in the empty state because that is
 * the one a first-run user meets), 7.3 ("after a relaunch … the pane's header
 * carries 'this terminal has ended' with the exit code if it was observed"), 11.4
 * (the secure lock is a fact about the surface), 15 (what the user reads for each
 * failure — the sentences here are that table's, not new ones).
 *
 * WHY THESE ARE ONE COMPONENT FAMILY RATHER THAN SIX AD-HOC BLOCKS: every one of
 * them is "the pane has nothing to mirror, and here is why", and a design round
 * reads them side by side. One layout means a difference between two of them is a
 * difference in their sentence, which is the reviewable thing.
 *
 * THEY USE THE APP'S OWN ROLES, NOT THE TERMINAL'S (§9.4): the ground is the
 * pane's `surface`, the ink is `ink`/`ink-muted`, and the terminal's own palette
 * applies only inside the mirror. That boundary is why the theme's ANSI mapping is
 * not consulted anywhere in this file.
 */

interface ConsoleNoticeProps {
	/** One sentence, in the app's voice, saying what this state IS. */
	title: string;
	/** Optional second sentence: what the user can do, or what it means. */
	detail?: string;
	/** The machine's own words, in the mono step: an error, an exit code, a path.
	 * Kept separate from `detail` because this is the line a bug report quotes. */
	machine?: string;
	/** An action, when there is one the user can take from here. */
	action?: ReactNode;
	/** The state's glyph. Absent for the loading and empty states, which are not
	 * conditions so much as "nothing here yet". */
	icon?: ReactNode;
	className?: string;
}

export const ConsoleNotice: FC<ConsoleNoticeProps> = ({
	title,
	detail,
	machine,
	action,
	icon,
	className,
}) => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-3 px-6 text-center",
			className,
		)}
		data-tour-tag="console-notice"
	>
		{icon}
		<div className={cn("flex flex-col gap-1")}>
			<p className={cn("text-body-sm text-ink")}>{title}</p>
			{detail ? (
				<p className={cn("text-ink-muted text-meta")}>{detail}</p>
			) : null}
		</div>
		{machine ? (
			<p className={cn("max-w-full break-words text-ink-dim text-mono-sm")}>
				{machine}
			</p>
		) : null}
		{action}
	</div>
);

/** Before the first read answers. The pane is a place, so its loading state is
 * the place without contents rather than a spinner over nothing. */
export const ConsoleLoading: FC = () => (
	<ConsoleNotice title="Reading this session's console" />
);

/**
 * The console is off, or its native dependency did not load (§15's two rows).
 *
 * The sentence names the feature, the detail says what to do, and the machine line
 * carries main's own words — which is what distinguishes "the kill switch is off in
 * this run" from "this build's terminal support failed to load", two conditions the
 * user can only tell apart by reading the message.
 */
export const ConsoleUnavailable: FC<{ message: string | null }> = ({
	message,
}) => (
	<ConsoleNotice
		icon={
			<AlertTriangle aria-hidden="true" className={cn("size-5 text-warning")} />
		}
		title="The console is not available in this app"
		detail="Terminal support did not load for this run. Updating Local Operator restores it, and the app's log names the reason."
		machine={message ?? undefined}
	/>
);

/** No surface in this session yet — and the `+` control lives HERE as well as in
 * the header, because this is the state a first-run user actually meets. */
export const ConsoleEmpty: FC<{ onCreate: () => void; disabled?: boolean }> = ({
	onCreate,
	disabled,
}) => (
	<ConsoleNotice
		icon={
			<SquareTerminal
				aria-hidden="true"
				className={cn("size-5 text-ink-dim")}
			/>
		}
		title="No console in this session"
		detail="A console runs a program in this conversation's directory and keeps its output, whether or not this pane is open."
		action={
			<Button
				variant="outline"
				size="sm"
				onClick={onCreate}
				disabled={disabled}
				data-tour-tag="console-empty-create"
			>
				<Plus aria-hidden="true" className={cn("size-4")} />
				New console
			</Button>
		}
	/>
);

/**
 * The banner over a surface that is not running (§7.3).
 *
 * TWO FACTS, and they are different questions. `exitCode` is what the process
 * returned, when it was observed at all — a surface restored from history ended
 * before this run existed and carries no code. `live` is whether the pty was ever
 * alive in this process; false is the relaunch case, where the honest sentence is
 * that the recorded history is what is on screen.
 */
export const ConsoleEndedBar: FC<{
	exitCode: number | null;
	live: boolean;
}> = ({ exitCode, live }) => (
	<div
		className={cn(
			"flex shrink-0 items-center gap-2 border-hairline border-b bg-elevated px-3 py-1.5",
		)}
		data-tour-tag="console-ended"
	>
		<span className={cn("text-ink-muted text-meta")}>
			{live
				? "This terminal has ended"
				: "This terminal has ended and its history was restored"}
		</span>
		<span className={cn("text-ink-dim text-mono-sm")}>
			{exitCode === null ? "exit code not observed" : `exit code ${exitCode}`}
		</span>
	</div>
);

/**
 * The secure-input marker (§11.4).
 *
 * A surface in this state still reaches the record — the pane keeps painting — but
 * nothing is written to the byte log, so nothing is retained and an agent's read is
 * refused with `secure_input_active`. The user is told that, in those words,
 * because the alternative is a person typing a password into a pane they believe is
 * being recorded.
 */
export const ConsoleSecureBar: FC = () => (
	<div
		className={cn(
			"flex shrink-0 items-center gap-2 border-hairline border-b bg-accent-wash px-3 py-1.5",
		)}
		data-tour-tag="console-secure"
	>
		<Lock aria-hidden="true" className={cn("size-3.5 shrink-0 text-accent")} />
		<span className={cn("text-ink text-meta")}>
			Secure input is on: what you type here is not recorded.
		</span>
	</div>
);
