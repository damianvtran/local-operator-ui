import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import {
	AlertTriangle,
	Lock,
	Plus,
	RefreshCw,
	SquareTerminal,
} from "lucide-react";
import type { FC, ReactNode } from "react";

/**
 * The console pane's non-terminal states, and the two banners that sit above its
 * terminal when one is showing history or refusing to record.
 *
 * Design: `local-operator`'s
 * `docs/design/ui-console-tab.md` — that repository's file, not one in this tree. 6.1 (empty and loading are the pane's
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
 * the place without contents rather than a spinner over nothing.
 *
 * TWO SENTENCES, ONE STATE, because they describe two different waits the same pane
 * can be in (design round 1, U4): after the user's open the pane waits for a shell to
 * start, not for a listing to arrive, and telling that user the pane is "reading this
 * session's console" describes the operation they did not ask for. The state is the
 * same and only the sentence changes, which is why this is a variant rather than a
 * second component. */
export const ConsoleLoading: FC<{ creating?: boolean }> = ({ creating }) => (
	<ConsoleNotice
		title={t(
			creating ? "ui.console.loading.create" : "ui.console.loading.read",
		)}
	/>
);

/**
 * The console is off, or its native dependency did not load (§15's two rows).
 *
 * THREE SENTENCES, NOT ONE, and the reason is the remedies are opposite. This state
 * shipped with a single paragraph whose remedy was "update Local Operator", shown
 * for every cause including the run the user (or their launcher) had deliberately
 * switched the console off with `LOCAL_OPERATOR_UI_CONSOLE_HOST=0` — advice to
 * reinstall an app that was working exactly as configured. The switch is the
 * difference between a setting and a broken install, so it is the thing the copy is
 * keyed on: `reason` is main's own word for why the host is absent, and only the
 * "native support did not load" row gets the update sentence.
 *
 * The machine line carries main's own `detail` (or the transport error when the
 * bridge itself is unreachable) because that is the line a bug report quotes, and
 * because it is what distinguishes the two rows for a reader who skips the prose.
 */
/*
 * The MESSAGE KEYS, resolved through t() at render time — keys may sit at module
 * scope, the messages they name may not (RFC §2.1; the manager's "call-time
 * rendering"). Two reasons carry the generic title, so it is one key.
 */
/*
 * KEYED, not literal copy: the sentences resolve at RENDER time through `t()`
 * (call-time rendering, RFC §2.3/§3.2), so a locale change re-renders the same
 * sentence in the new language. `as const` keeps each value a literal key so
 * the two-overload `t()` still typechecks the lookup.
 */
const UNAVAILABLE_KEYS = {
	disabled: {
		title: "ui.console.unavailable.disabled.title",
		detail: "ui.console.unavailable.disabled.detail",
	},
	pty_unavailable: {
		title: "ui.console.unavailable.title",
		detail: "ui.console.unavailable.pty.detail",
	},
	unknown: {
		title: "ui.console.unavailable.title",
		detail: "ui.console.unavailable.unknown.detail",
	},
} as const;

export const ConsoleUnavailable: FC<{
	reason: string | null;
	detail: string | null;
	message: string | null;
}> = ({ reason, detail, message }) => {
	/* An unknown reason string falls to the generic row; the cast is the reason
	   the lookup can take main's own word rather than a closed union. */
	const keys =
		UNAVAILABLE_KEYS[reason as keyof typeof UNAVAILABLE_KEYS] ??
		UNAVAILABLE_KEYS.unknown;
	return (
		<ConsoleNotice
			icon={
				<AlertTriangle
					aria-hidden="true"
					className={cn("size-5 text-warning")}
				/>
			}
			title={t(keys.title)}
			detail={t(keys.detail)}
			machine={detail ?? message ?? undefined}
		/>
	);
};

/**
 * A create that was refused by the console host (§15's "a surface could not be
 * started" row).
 *
 * WHY THIS IS NOT `ConsoleUnavailable`, and this is the finding it was added for
 * (design round 1, U2). With the host answering normally and only the CREATE failing,
 * the pane used to render the unavailable state: "The console is not available in this
 * app", whose next line is "Terminal support did not load for this run. Updating Local
 * Operator restores it" — four statements, none of them true of a transient pty
 * failure, one of them printed directly above the machine line that named the real
 * cause, and the remedy (reinstall the app) the opposite of the action that helps.
 *
 * IT LEADS WITH THE ATTEMPT, NOT THE APP: the console is available here — that is what
 * makes this state different from its neighbour — and the thing to offer is another
 * attempt, which is the same action as the header's `+` and the empty state's button.
 * The host's own words go on the machine line, unedited, because that line is what a
 * bug report quotes (the first cut's copy is what told the user the app "did not say
 * why" while quoting the reason below it).
 */
export const ConsoleCreateFailed: FC<{
	message: string | null;
	onRetry: () => void;
}> = ({ message, onRetry }) => (
	<ConsoleNotice
		icon={
			<AlertTriangle aria-hidden="true" className={cn("size-5 text-warning")} />
		}
		title={t("ui.console.create_failed.title")}
		detail={t("ui.console.create_failed.detail")}
		machine={message ?? undefined}
		action={
			<Button
				variant="outline"
				size="sm"
				onClick={onRetry}
				data-tour-tag="console-create-retry"
			>
				<RefreshCw aria-hidden="true" className={cn("size-4")} />
				{t("ui.console.create_failed.retry")}
			</Button>
		}
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
		title={t("ui.console.empty.title")}
		detail={t("ui.console.empty.detail")}
		action={
			<Button
				variant="outline"
				size="sm"
				onClick={onCreate}
				disabled={disabled}
				data-tour-tag="console-empty-create"
			>
				<Plus aria-hidden="true" className={cn("size-4")} />
				{t("ui.console.new")}
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
 *
 * IT IS ALSO THE BEAT'S NOTICE (#929, 2026-10-10): for a surface whose shell exited
 * cleanly during this run, the pane lets this banner stand for
 * `EXIT_DISMISS_AFTER_MS` (its own constant, in `console-pane.tsx`) and then clears
 * the row — the banner is the frame that says what happened, and an instant removal
 * would read as a crash. A non-zero code and a restored row keep it indefinitely.
 */
export const ConsoleEndedBar: FC<{
	exitCode: number | null;
	/** The signal that ended the process, when node-pty reported one (Q-3). A
	 * signalled exit carries code 0 in node-pty, so this is the only field that can
	 * tell a `kill -9` from a clean exit; it wins over the code when present. */
	exitSignal?: string | null;
	live: boolean;
	/** Why the surface ended when no exit code was observed. `app_quit` is main's
	 * own record that the app closed it on the way out (`host.dispose`), and it is
	 * a different sentence from "not observed": the exit may well never be
	 * observable there, and telling the user nobody looked is the misleading half
	 * the operator reported. Legacy sidecars carry null and keep the honest one. */
	endReason?: "app_quit" | null;
}> = ({ exitCode, exitSignal = null, live, endReason = null }) => (
	/* The notice is a band on the PANE's ground, so it wears a step of its own:
	   `elevated` on the drawer's rung (`canvas/index.tsx`) measures ΔE00 0, which
	   is why this is `surface` — a step down that survives every palette, and the
	   same way the browser's consent bar reads. */
	<div
		className={cn(
			"flex shrink-0 items-center gap-2 border-hairline border-b bg-surface px-3 py-1.5",
		)}
		data-tour-tag="console-ended"
	>
		<span className={cn("text-ink-muted text-meta")}>
			{t(live ? "ui.console.ended.live" : "ui.console.ended.restored")}
		</span>
		<span className={cn("text-ink-dim text-mono-sm")}>
			{exitSignal !== null
				? t("ui.console.ended.exit_signal", { signal: exitSignal })
				: exitCode !== null
					? t("ui.console.ended.exit_code", { code: String(exitCode) })
					: endReason === "app_quit"
						? t("ui.console.ended.app_quit")
						: t("ui.console.ended.exit_unknown")}
		</span>
	</div>
);

/**
 * THE END OF THE RECORDED HISTORY, painted where a live prompt would be.
 *
 * A PANE-OWNED ELEMENT, never bytes written into the terminal, and that is the
 * point rather than a style choice: fake output would be indistinguishable from
 * something the program printed, would be replayed into a later capture as if the
 * shell had said it, and would be unselectable-as-chrome. This row is outside the
 * mirror's box, in the pane's own roles and type, so a person and a screenshot
 * agree that the terminal stopped here.
 *
 * IT IS ALSO THE LIVE REGION FOR A KEYSTROKE. `announced` is the pane's answer to a
 * key that arrived while this surface was ended (see `console-pane.tsx`'s choice):
 * `role="status"` with `aria-live` means the sentence is spoken, and the same
 * sentence is visible here so a sighted user is not left guessing why nothing
 * typed. The marker itself is always present, which is what makes the state
 * legible before anyone presses a key.
 */
export const ConsoleHistoryEnd: FC<{
	announcement: string;
	/** The press counter, exposed for tests and for the live region's own
	 * re-announcement; it has no visible role. */
	announcementSeq?: number;
}> = ({ announcement, announcementSeq = 0 }) => (
	<div
		/* TWO ROWS, ALWAYS (D3): the marker row and a reserved announcement row.
		   `min-h-4` on a flex-wrap row was not enough - the sentence took its own
		   wrapped row and moved the band's top border by ~21.5 px on the first
		   refusal. An always-present row makes empty and spoken the same height. */
		className={cn(
			"flex shrink-0 flex-col gap-0.5 border-hairline border-t bg-sunken px-3 py-1.5",
		)}
		data-tour-tag="console-history-end"
	>
		<div className={cn("flex flex-wrap items-center gap-x-3")}>
			<span className={cn("text-ink-muted text-meta")}>
				{t("ui.console.ended.marker")}
			</span>
			<span className={cn("text-ink-dim text-meta")}>
				{t("ui.console.ended.marker_detail")}
			</span>
		</div>
		<output
			aria-live="polite"
			className={cn("min-h-5 text-ink text-meta")}
			data-announce-seq={announcementSeq}
			data-tour-tag="console-history-announce"
		>
			{announcement}
		</output>
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
	/*
	 * AN OVERLAY, AND THAT IS A CORRECTION RATHER THAN A STYLE. In the flex column
	 * this banner used to cost the terminal ~2 rows, so flipping the toggle moved the
	 * mirror's content box and main re-derived the grid from it — one `SIGWINCH` on a
	 * user's own switch, sent to whatever program they were running. A control the
	 * user flips is not allowed to resize their program (design 8.2's box is the
	 * pane's CONTENT box, and this is chrome over it), so the marker is painted over
	 * the top rows instead: the grid never moves, and because it is a marker rather
	 * than a place, it is `pointer-events-none` so a click on the row behind it still
	 * reaches the terminal.
	 *
	 * The ENDED banner keeps the layout row it had, and the difference is which one
	 * can move a live program: by the time that banner appears there is no process
	 * left to reflow (§7.3), and it stands over a history that is no longer changing.
	 */
	<div
		className={cn(
			"pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-hairline border-b bg-accent-wash px-3 py-1.5",
		)}
		data-tour-tag="console-secure"
	>
		<Lock aria-hidden="true" className={cn("size-3.5 shrink-0 text-accent")} />
		<span className={cn("text-ink text-meta")}>{t("ui.console.secure")}</span>
	</div>
);
