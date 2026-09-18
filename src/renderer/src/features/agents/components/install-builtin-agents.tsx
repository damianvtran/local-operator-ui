import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { ReusableProfile } from "@shared/api/local-operator/profile-hooks";
import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Layers } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type InstallSummary,
	installBuiltins,
	summaryExceptionSentence,
	summarySentence,
} from "../install-builtin-batch";

/**
 * Install every built-in agent, one at a time, and report what happened to each.
 *
 * ## Why the local backend and not the hub
 *
 * The built-ins come from the LOCAL backend's packaged profiles
 * (`profiles.list`, rows whose `source` is `"builtin"`), which is the same list
 * the reserved-name check reads. Nothing in this action talks to Radient: the
 * hub is where agents are published to, not where a user's own roles come from.
 *
 * ## One implementation, two mount points
 *
 * The shortcut appears in the chat sidebar's Agents section, both as the empty
 * state of a user with no agents and as a quiet row for a user with some. Both
 * render THIS component — and the agents page may mount it too — so the two
 * cannot disagree about what "already present" means. The per-name rules it
 * applies live in `install-builtin-batch.ts`, because they are the part a
 * behavioural test can hold without a renderer.
 */

export type InstallBuiltinAgentsProps = {
	/** The built-in rows still to install, in catalogue order. */
	builtins: readonly ReusableProfile[];
	/**
	 * How the action renders where it is mounted:
	 *
	 *  - `row` — a quiet line that sits among the sidebar's own rows, for a user
	 *    who already has agents and does not need to be told about built-ins;
	 *  - `primary` — the full-width action a user with no agents at all is
	 *    offered, where "install all of them" IS the next step.
	 *
	 * The progress and the summary are the same in both, because the thing being
	 * reported is the same batch.
	 */
	presentation?: "row" | "primary";
	className?: string;
};

export const InstallBuiltinAgents: FC<InstallBuiltinAgentsProps> = ({
	builtins,
	presentation = "row",
	className,
}) => {
	const queryClient = useQueryClient();
	const [running, setRunning] = useState(false);
	const [done, setDone] = useState(0);
	const [current, setCurrent] = useState<string | null>(null);
	const [summary, setSummary] = useState<InstallSummary | null>(null);
	const dismissRef = useRef<HTMLButtonElement>(null);
	/* The action that starts the batch: where focus returns after the summary is
	 * dismissed, because it is the section's own next control and it is what the
	 * user is looking at again. */
	const actionRef = useRef<HTMLButtonElement>(null);
	/* The batch's one live region: mounted with the section, written into at each
	 * step and at the end (UX round 2, U11). */
	const liveRef = useRef<HTMLOutputElement>(null);
	/* Whether the summary on screen was dismissed BY THE USER, which is the only
	 * case that hands focus on: it also becomes null when a new run starts. */
	const dismissedRef = useRef(false);

	/*
	 * The finish line lands focus on the control that clears it.
	 *
	 * The batch can be started from a keyboard and ends seconds later, by which
	 * time the live region that was announcing it has been replaced by the
	 * summary: measured before this, focus after the batch settled was on
	 * `document.body`, and the only exit from the completed state was a 29.7 x
	 * 17.4px dim link (UX round 1, U4). A live region without a focus target
	 * leaves the user to find their own way out of the state they are now in.
	 */
	useEffect(() => {
		if (summary) dismissRef.current?.focus();
	}, [summary]);

	/*
	 * The two transitions either side of the batch, both of which used to leave
	 * focus on `document.body`.
	 *
	 * Pressing the action unmounts it, so within ~150ms focus was on the body and
	 * stayed there for the whole 3.7s run — a `focusin` trail of INPUT, Agents,
	 * install with nothing in between — and pressing `Done` unmounts that too, so
	 * the next Tab restarted at the window's first control. The progress region is
	 * the thing that survives the press and reports the run, and the action is what
	 * survives the dismissal (UX round 2, U10). Both moves are deliberate, and both
	 * are read AFTER the re-render that swapped the controls.
	 */
	useEffect(() => {
		if (running) liveRef.current?.focus();
	}, [running]);

	useEffect(() => {
		if (summary || !dismissedRef.current) return;
		dismissedRef.current = false;
		actionRef.current?.focus();
	}, [summary]);

	const run = useCallback(async () => {
		if (running || builtins.length === 0) return;
		setRunning(true);
		setSummary(null);
		setDone(0);
		const result = await installBuiltins(
			builtins.map((builtin) => builtin.name),
			(name) =>
				desktopResult<ReusableProfile>({
					op: "profiles.install",
					name,
					// A fresh id per NAME rather than per batch: the receipt store
					// replays a retried call instead of copying twice, and two names
					// sharing one id would make the second replay the first.
					requestId: crypto.randomUUID(),
				}),
			(progress) => {
				setDone(progress.done);
				setCurrent(progress.current);
			},
		);
		setCurrent(null);
		setSummary(result);
		setRunning(false);
		// The installed names are rows in the caller's catalogue now, so the list
		// that decided what was missing has to be re-read.
		await queryClient.invalidateQueries({ queryKey: ["desktop", "profiles"] });
	}, [builtins, queryClient, running]);

	if (builtins.length === 0 && !summary) return null;

	const total = builtins.length;
	/*
	 * The step the bar and the sentence BOTH report: completed installs plus the
	 * one in flight. They used to disagree by one for the whole run — the bar
	 * counted completed installs and the sentence counted the item in flight, so
	 * "Installing 1 of 6" sat over a bar at 0% and the run reached "6 of 6" with
	 * the bar still at 83% (design round 1, D2). One quantity, one reading.
	 */
	const step = done + (current ? 1 : 0);
	const exceptionLine = summary ? summaryExceptionSentence(summary) : null;
	/*
	 * The row presentation sits among list rows that pad themselves; the primary
	 * one is mounted inside a block that already pads. Padding twice would inset
	 * the progress line and the summary out of line with the copy above them.
	 */
	const pad = presentation === "row" ? "px-3" : undefined;

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			{/*
			 * The ternary is the fragment's only child, so the wrapper added an
			 * indentation level and nothing else (biome's `noUselessFragments` names
			 * it, and it is right).
			 */}
			{!running &&
				!summary &&
				(presentation === "primary" ? (
					<Button
						ref={actionRef}
						variant="secondary"
						className="w-full"
						onClick={() => void run()}
					>
						Install all built-in agents
					</Button>
				) : (
					<button
						ref={actionRef}
						type="button"
						onClick={() => void run()}
						className={cn(
							"flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5",
							"text-left text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart",
							"hover:bg-elevated",
						)}
						data-testid="install-all-builtins-row"
					>
						<Layers className="size-4 shrink-0" aria-hidden="true" />
						<span className="min-w-0 flex-1">
							{total} built-in {total === 1 ? "agent" : "agents"} available
						</span>
						<span className="shrink-0 font-medium text-accent">
							Install all {total}
						</span>
					</button>
				))}

			{/*
			 * ONE live region for the whole batch, mounted with the section and written
			 * into at each step and at the end — not the two regions this used to be, each
			 * INSERTED already holding its text, which is the shape assistive technology
			 * is least reliable about: `install-builtins-progress` arrived with 26
			 * characters already inside it and `install-builtins-summary` with 16, and
			 * whether either was announced depended on how the AT treats a `role=status`
			 * node that appears with its content already in it (UX round 2, U11). Nothing
			 * here is announced because a region APPEARED: the sentence changes and the
			 * region that was always there says so. `sr-only` while idle, so it costs no
			 * line and no gap in a section that is usually showing only its action.
			 *
			 * It is also where focus goes for the run, and `tabIndex={-1}` is what makes
			 * that possible: a region is not a control and must not join the tab order,
			 * but it is the thing on screen that survives the press (UX round 2, U10).
			 */}
			<output
				ref={liveRef}
				aria-live="polite"
				tabIndex={-1}
				data-testid="install-builtins-live"
				className={cn("flex flex-col gap-2", !running && !summary && "sr-only")}
			>
				{running && (
					<div
						className={cn("flex flex-col gap-1.5", pad)}
						data-testid="install-builtins-progress"
					>
						<Progress
							value={step}
							max={total}
							aria-label={`Installing built-in agents, ${step} of ${total}`}
							/*
							 * The track carries the STRUCTURAL role rather than the sunken step the
							 * primitive defaults to. `sunken` on `surface` measures 1.11-1.26:1
							 * across the twelve palettes, so at 0% the bar read as blank card and at
							 * 100% as a coloured rule rather than a meter — measured on the
							 * rendered installing frames as 1.15:1 in light, 1.3:1 in dark and
							 * 1.4:1 in neon, i.e. fainter than the app's own section hairline in the
							 * same frame (design round 1, D2). A meter's track is the reference its
							 * fill is read against, so removing it loses information and 3:1 applies;
							 * `border-control` is the only role that carries that floor. Same
							 * treatment and same reasoning as the quota bar's track in
							 * `usage-view.tsx`.
							 *
							 * `h-1.5` rather than the primitive's `h-1`: the 1px border would other-
							 * wise take half the meter, which the quota bar found too and answers the
							 * same way. The interior stays 4px, so the datum is no thinner than it
							 * was.
							 *
							 * This class string is pinned in `scripts/contrast-contract.mjs`, so the
							 * edit that drops the track's role fails a gate rather than needing a
							 * frame review to notice.
							 */
							className="h-1.5 border border-control"
						/>
						{/*
						 * A determinate count and the name in flight, so a slow install
						 * of the fourth agent does not read as a hung first one. The
						 * count is of COMPLETED installs; the name is the one running.
						 *
						 * No `aria-live` of its own: the sentence is written into the
						 * region above, which is what makes it announced (U11), and a
						 * second live region here would announce the same step twice.
						 */}
						<p className="text-meta text-ink-muted">
							{current
								? `Installing ${step} of ${total} — ${current}…`
								: `Installing ${done} of ${total}…`}
						</p>
					</div>
				)}

				{summary && (
					/*
					 * A `<div>` rather than the `<output>` this was, and no `aria-live` of its
					 * own: it IS the region's content now, and a `role="status"` node nested
					 * inside a polite region announces the same sentence twice. The line under
					 * the check is `body-sm` in full ink rather than a `text-meta` fragment,
					 * because it is the answer to the action the user just took (D7).
					 */
					<div
						className={cn("flex flex-col gap-2", pad)}
						data-testid="install-builtins-summary"
					>
						<p className="flex items-center gap-1.5 text-body-sm text-ink">
							<Check
								className="size-3.5 shrink-0 text-success"
								aria-hidden="true"
							/>
							<span>{summarySentence(summary)}</span>
						</p>
						{/*
						 * ONE line for the skips, led by its count and a capital: the previous
						 * shape began a lower-case fragment per name ("skipped: you have an
						 * agent called "reviewer"") under a sentence that had already counted
						 * it, which is a sentence broken across two paragraphs (design round 1,
						 * D7). A failure still gets its own line, because each carries its own
						 * message rather than contributing to a count.
						 */}
						{exceptionLine && (
							<p className="text-body-sm text-ink-muted">{exceptionLine}</p>
						)}
						{summary.failed.map((failure) => (
							<p key={failure.name} className="text-body-sm text-danger">
								{failure.name}: {failure.message}
							</p>
						))}
						{/*
						 * A real control at the app's own small size (28px) rather than a 30x11
						 * underlined word with no padding target, which was the only way out of
						 * this state and under the 24px floor every other control here holds
						 * (D7, U4). It takes focus when the batch ends, and hands it back to the
						 * action that started the batch when it dismisses the summary (U10).
						 */}
						<Button
							ref={dismissRef}
							variant="ghost"
							size="sm"
							className="w-fit"
							onClick={() => {
								dismissedRef.current = true;
								setSummary(null);
							}}
						>
							Done
						</Button>
					</div>
				)}
			</output>
		</div>
	);
};
