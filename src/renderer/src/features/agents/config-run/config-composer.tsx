/**
 * The conversational configuration surface: the composer, the run strip, and the
 * settled summary.
 *
 * WHAT IT IS NOT. It is not the app's chat composer and must never read as one
 * (UX brief, must-nots): no slash dispatch, no attachments, no `@` references, no
 * draft store, no route change. It is a small textarea whose only write is
 * `sessions.create{purpose}` + `sessions.message` on the RUN's id, and whose copy
 * says so out loud in one quiet line — "This does not appear in your
 * conversation" — because the operator's reasonable fear, on a page that already
 * hands work to a chat, is that this went to the thread they keep with Aida.
 *
 * NAMING (frozen across the sibling changes): a **configuration run**. Never
 * "aside", "btw" or "subagent" — the aside is an off-record model-only question
 * asked inside an open conversation, and a subagent is a child of one. This is a
 * supervised background session that WRITES the agent and team registries.
 *
 * THE STRIP IS A LIVE REGION AND NOT A SPINNER. Its state dot, its one-line step
 * and its elapsed time are the whole of the progress vocabulary: there is no
 * percentage to show and inventing one is the fake-progress failure branding §7
 * names. `Watch` opens the run's own tool rows, which is the same level of detail
 * the subagent reader shows per child.
 */

import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronRight, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfigRunHandle } from "./use-config-run";

/** Three things an operator actually asks for, as one-press examples. */
const EXAMPLES = [
	"A reviewer that only reads code",
	"Add the coder twice to release-crew",
	"A team called shipping with a manager and two coders",
];

const STATE_DOT: Record<string, string> = {
	idle: "bg-ink-dim",
	running: "bg-accent",
	stopping: "bg-warning",
	done: "bg-success",
	stopped: "bg-ink-muted",
	error: "bg-danger",
};

function StateDot({ status, pulse }: { status: string; pulse: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full",
				STATE_DOT[status] ?? "bg-ink-dim",
				// Motion is a colour-adjacent signal here, never a transform: nothing
				// lifts or scales on this page, and a pulsing dot is the one animation
				// that carries meaning (work is happening).
				pulse && "animate-pulse",
			)}
		/>
	);
}

/** The run's own steps, one line each, newest last. */
function RunActivity({ run }: { run: ConfigRunHandle }) {
	if (run.activity.length === 0) {
		return (
			<p className="text-meta text-ink-muted">
				Nothing to show yet — the run has not called a tool.
			</p>
		);
	}
	return (
		<ul className="max-h-48 space-y-1 overflow-y-auto">
			{run.activity.map((row, index) => (
				<li
					// The row's own instant is its identity: a run may call the same tool
					// on the same target twice, and an index-only key would mis-reconcile.
					key={`${row.ts}:${row.verb}:${index}`}
					className="flex items-baseline gap-2 text-body-sm"
				>
					<span className="text-ink-dim tabular-nums">
						{new Date(row.ts).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</span>
					<span className="text-ink">{row.verb}</span>
				</li>
			))}
		</ul>
	);
}

function RunStrip({
	run,
	onDismiss,
}: {
	run: ConfigRunHandle;
	/** Wraps `run.dismiss` so the caret lands back in the box (UX U8). */
	onDismiss?: () => void;
}) {
	const [watching, setWatching] = useState(false);
	const stopRef = useRef<HTMLButtonElement>(null);
	const live = run.status === "running" || run.status === "stopping";

	/*
	 * Escape focuses Stop while a run is live — the accelerator the chat composer
	 * gives its own Stop. It is a FOCUS move rather than a stop: an Escape that
	 * killed a paid turn by accident is worse than one that did nothing, and the
	 * button is then one press away with the focus ring showing where it landed.
	 */
	useEffect(() => {
		if (!live) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			/*
			 * A dismissable layer owns Escape while it is open (review round 1, n1):
			 * Radix marks the key handled, and the page's discard confirmation is
			 * exactly the case where "close the dialog" must not also pull focus to
			 * a button in another card. `defaultPrevented` covers the first, and the
			 * open-dialog read covers the second.
			 */
			if (document.querySelector('[role="alertdialog"], [role="dialog"]'))
				return;
			stopRef.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [live]);

	const title =
		run.status === "running"
			? (run.step ?? "Working on your request")
			: run.status === "stopping"
				? "Stopping"
				: run.status === "done"
					? run.results.length > 0
						? "Finished"
						: "Finished without changing anything"
					: run.status === "stopped"
						? "Stopped"
						: run.status === "error"
							? /*
								 * TWO DIFFERENT FAILURES, TWO HEADINGS (UX review round 3,
								 * U2). "Stopped with an error" described a stopped run, and
								 * it was shown over the settle-read failure whose own body
								 * says the run FINISHED — a heading contradicting the
								 * sentence under it. The refused-stop case that shared this
								 * title no longer reaches the error state at all (U1), so
								 * the split is by what actually happened: nothing was sent
								 * (`canRetry`) versus a run that ran and then could not be
								 * read back.
								 */
								run.canRetry
								? "Stopped with an error"
								: "Finished with an error"
							: "";

	return (
		<div
			className="border-hairline border-b pb-2"
			data-testid="config-run-strip"
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<StateDot status={run.status} pulse={live} />
				<span aria-live="polite" className="text-body-sm text-ink">
					{title}
				</span>
				{(live || run.status === "stopped" || run.status === "done") &&
				run.elapsed !== "0s" ? (
					<span className="text-meta text-ink-muted tabular-nums">
						{run.elapsed}
					</span>
				) : null}
				{run.touched.length > 0 ? (
					<Badge variant="neutral">
						{run.touched.length === 1
							? "1 definition"
							: `${run.touched.length} definitions`}
					</Badge>
				) : null}
				<div className="ml-auto flex items-center gap-1">
					{run.activity.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							aria-expanded={watching}
							onClick={() => setWatching((open) => !open)}
						>
							{watching ? (
								<ChevronDown className="size-3.5" />
							) : (
								<ChevronRight className="size-3.5" />
							)}
							Watch
						</Button>
					) : null}
					{live ? (
						<Button
							ref={stopRef}
							variant="secondary"
							size="sm"
							disabled={run.status === "stopping"}
							onClick={() => void run.stop()}
						>
							<Square className="size-3.5" />
							{run.status === "stopping" ? "Stopping…" : "Stop"}
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => (onDismiss ? onDismiss() : run.dismiss())}
						>
							Dismiss
						</Button>
					)}
				</div>
			</div>
			{run.attached ? (
				<p className="mt-1 text-meta text-ink-muted">
					Another configuration run was already going, so this page attached to
					it. Your request was not sent — it is still in the box.
				</p>
			) : null}
			{/*
			 * THE STOP THAT DID NOT TAKE (UX review round 3, U1).
			 *
			 * A refused interrupt used to render the settled error shape: the live
			 * Stop and the elapsed time vanished, Dismiss was the only control left,
			 * and the strip said the run had stopped — while it went on writing
			 * definitions. The strip keeps its live shape in that case (Stop still
			 * pressable, the clock still running) and says what happened here, with
			 * the refusal's own reason under it when the backend gave one.
			 */}
			{run.stopError ? (
				<div
					className="mt-2 border-danger-border border-t pt-2"
					data-testid="config-stop-refused"
				>
					<p className="text-body-sm text-danger">
						The stop did not take — the run is still going.
					</p>
					<p className="mt-0.5 text-meta text-ink-muted">{run.stopError}</p>
				</div>
			) : null}
			{watching ? (
				<div className="mt-2 border-hairline border-t pt-2">
					<RunActivity run={run} />
				</div>
			) : null}
			{/*
			 * THE STOPPED CASE SAYS WHAT IT KEPT. Cancellation is not rollback: the
			 * tools write through as they go, so a stop mid-run leaves whatever it had
			 * already written, and the honest sentence is the one that says so rather
			 * than implying the machine was put back — and a stop that happened before
			 * anything was written says THAT instead (review round 1, UX nit: the kept
			 * sentence was shown over an empty result list).
			 */}
			{run.status === "stopped" ? (
				<div className="mt-2 space-y-1 border-hairline border-t pt-2 text-body-sm">
					<p className="text-ink">
						{run.results.length > 0
							? "Stopped. Changes it had already made were kept."
							: "Stopped. Nothing had been changed yet."}
					</p>
					{run.results.length > 0 ? (
						<ul className="space-y-0.5">
							{run.results.map((result) => (
								<li
									key={`${result.target.kind}:${result.target.name}`}
									className="text-ink-muted"
								>
									{result.created ? "Created " : "Changed "}
									<span className="text-ink">{result.target.name}</span>
								</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
			{run.status === "done" ? <RunSummary run={run} /> : null}
			{run.status === "error" && run.error ? (
				<div className="mt-2 border-danger-border border-t pt-2">
					<p className="text-body-sm text-danger">{run.error}</p>
					<div className="mt-1 flex items-center gap-2">
						{/*
						 * RETRY, WHEN THERE IS SOMETHING TO RETRY ON. The message-call
						 * failure is the one error the page can act on — the run exists and
						 * the text is still in the box — so the strip offers the same call
						 * again rather than telling the operator to send it themselves
						 * (review round 1, UX U10).
						 */}
						{run.canRetry ? (
							<Button
								variant="secondary"
								size="sm"
								data-testid="config-retry"
								disabled={run.starting}
								onClick={() => void run.retry()}
							>
								{run.starting ? "Sending…" : "Retry"}
							</Button>
						) : null}
						<p className="text-meta text-ink-muted">
							Nothing else was changed by this run.
						</p>
					</div>
				</div>
			) : null}
		</div>
	);
}

/**
 * Exactly what changed, in the operator's words.
 *
 * WHY THIS IS NOT A SUCCESS TOAST. A configuration run writes text that future
 * sessions obey, so the change has to be NAMED where the operator can read it and
 * not only announced — and branding §7 wants a completed action as a quiet line
 * rather than a card. A run that changed nothing says that instead of showing an
 * empty list (the design's "zero touched entities" case), and an update whose
 * catalogue fields did not move says which fact it cannot see from here.
 */
function RunSummary({ run }: { run: ConfigRunHandle }) {
	if (run.results.length === 0) {
		return (
			<div className="mt-2 border-hairline border-t pt-2 text-body-sm">
				<p className="text-ink-muted">
					The run answered without changing any agent or team.
				</p>
				{/*
				 * THE ANSWER ITSELF, and the request it answers. "The run answered" is a
				 * claim the operator cannot check from here otherwise: the zero-touched
				 * case is DEFINED as "the run answered a question", and the sentence and
				 * the question were the two things missing (review round 1, UX U3).
				 */}
				{run.answer ? (
					<p className="mt-1 whitespace-pre-wrap text-ink">{run.answer}</p>
				) : null}
				{run.topic ? (
					<p className="mt-1 text-meta text-ink-muted">
						You asked: {run.topic}
					</p>
				) : null}
			</div>
		);
	}
	return (
		<div className="mt-2 space-y-1 border-hairline border-t pt-2">
			<ul className="space-y-1 text-body-sm">
				{run.results.map((result) => (
					<li key={`${result.target.kind}:${result.target.name}`}>
						<span className="text-ink">
							{result.created ? "Created " : "Updated "}
							{result.target.name}
						</span>
						<span className="text-ink-muted"> ({result.target.kind})</span>
						{result.changes.length > 0 ? (
							<span className="text-ink-muted">
								{": "}
								{result.changes.map((change) => change.label).join(", ")}
							</span>
						) : result.created ? null : (
							<span className="text-ink-muted">
								{
									": its settings changed. The list does not show instructions, so open it to see what was written."
								}
							</span>
						)}
					</li>
				))}
			</ul>
			{run.answer ? (
				<p className="whitespace-pre-wrap text-body-sm text-ink-muted">
					{run.answer}
				</p>
			) : null}
		</div>
	);
}

export function ConfigComposer({
	run,
	hero = false,
	blockedReason,
	/** Names the row the next request is about, when one is selected. */
	about,
	onClearAbout,
	onStripHeightChange,
}: {
	run: ConfigRunHandle;
	hero?: boolean;
	blockedReason?: string | null;
	about: { kind: "agent" | "team"; name: string } | null;
	onClearAbout: () => void;
	/**
	 * The docked strip's own height, in px, while it is shown (0 when it is not).
	 *
	 * THE OVERLAY TRADES ONE PROBLEM FOR ANOTHER unless the pane is told how much
	 * room it is covering: floating above the composer stopped the strip from
	 * resizing the scroller (D4), and then sat on the last 106 px of the detail,
	 * which scrolling could not reach (design review round 2, D12). The page adds
	 * this to the scroller's bottom padding, so the last block can clear it.
	 */
	onStripHeightChange?: (height: number) => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const stripObserver = useRef<ResizeObserver | null>(null);
	/*
	 * A CALLBACK REF RATHER THAN AN EFFECT, because the fact this measures is the
	 * node MOUNTING: the strip exists only from `running` on, and what changes its
	 * height afterwards is its own content (the Watch list opening, a settled
	 * summary arriving). React calls this with the node when it mounts, with a new
	 * node if it is replaced, and with null on the way out — which is exactly the
	 * three moments the pane's reserved room changes, and it keeps the hook's own
	 * dependency rule honest instead of listing values the effect never reads.
	 */
	const measureStrip = useCallback(
		(node: HTMLDivElement | null) => {
			stripObserver.current?.disconnect();
			stripObserver.current = null;
			if (!onStripHeightChange) return;
			if (!node) {
				onStripHeightChange(0);
				return;
			}
			const report = () =>
				onStripHeightChange(node.getBoundingClientRect().height);
			report();
			if (typeof ResizeObserver === "undefined") return;
			const observer = new ResizeObserver(report);
			observer.observe(node);
			stripObserver.current = observer;
		},
		[onStripHeightChange],
	);
	const live = run.status === "running" || run.status === "stopping";
	const disabled = !run.enabled || live || Boolean(blockedReason);
	const placeholder = about
		? `Change ${about.name}…`
		: run.enabled
			? "Ask for a new agent or change a team…"
			: "Configure agents by conversation";

	/*
	 * "ASK FOR A CHANGE" ARRIVES FROM ELSEWHERE, so the caret has to land here.
	 * The detail pane's own button seeds the draft and names the target; the
	 * operator's next keystroke belongs in this box, and without this the focus
	 * stayed on `BODY` — a keyboard user had no cue that anything had happened
	 * (review round 1, D9).
	 */
	const aboutKey = about ? `${about.kind}:${about.name}` : null;
	useEffect(() => {
		if (!aboutKey) return;
		const node = textareaRef.current;
		if (!node || node.disabled) return;
		node.focus();
		const end = node.value.length;
		node.setSelectionRange?.(end, end);
	}, [aboutKey]);

	const send = () => {
		const text = run.draft.trim();
		if (!text || disabled) return;
		void run.start(text, about);
	};

	/**
	 * DISMISS AND CLEAR PUT THE CARET BACK (UX U8). Both retire the control the
	 * operator just pressed, and focus used to fall to `body` — a keyboard user
	 * then had no cursor anywhere on the page.
	 */
	const dismissAndFocus = () => {
		run.dismiss();
		textareaRef.current?.focus();
	};
	const clearAboutAndFocus = () => {
		onClearAbout();
		textareaRef.current?.focus();
	};

	return (
		<div
			className={cn(
				"relative rounded-md border border-hairline bg-surface p-3",
				hero && "shadow-none",
			)}
			data-testid="config-composer"
		>
			<div className="sr-only" id="config-composer-label">
				Ask for an agent or team change
			</div>
			{/*
			 * THE STRIP FLOATS IN THE DOCKED COMPOSER (design review round 1, D4).
			 * Inside the flow it pushed the pane it is docked under: measured 629 px
			 * of detail at rest, 699 while typing and 547 once a run settled — a 152
			 * px shift of the content the operator was reading, with the summary
			 * landing flush on the textarea's border. Above the box it covers the
			 * scroller's last lines instead of moving them, and the pane's height
			 * stops depending on the run's state. The hero (nothing selected, no pane
			 * to protect) keeps it in the flow, where a growing card is the point.
			 */}
			{run.enabled && run.status !== "idle" ? (
				hero ? (
					<RunStrip run={run} onDismiss={dismissAndFocus} />
				) : (
					<div
						ref={measureStrip}
						className="absolute inset-x-0 bottom-full rounded-t-md border-hairline border bg-canvas p-3"
					>
						<RunStrip run={run} onDismiss={dismissAndFocus} />
					</div>
				)
			) : null}
			{about ? (
				<div className="mb-2 flex items-center gap-2">
					<Badge variant="accent" data-testid="config-composer-about">
						About {about.kind} {about.name}
					</Badge>
					<Button variant="ghost" size="sm" onClick={clearAboutAndFocus}>
						Clear
					</Button>
				</div>
			) : null}
			<label className="sr-only" htmlFor="config-composer-input">
				{placeholder}
			</label>
			<Textarea
				id="config-composer-input"
				ref={textareaRef}
				aria-describedby="config-composer-note"
				className="min-h-16"
				placeholder={placeholder}
				value={run.draft}
				disabled={disabled || !run.enabled}
				onChange={(event) => run.setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						send();
					}
				}}
			/>
			{/*
			 * THE CHIPS STAY WHILE THE BOX IS FOCUSED, and they are disabled with it
			 * (design review round 1, D4/U11 and D9). Unmounting them on focus moved
			 * every control under the pointer by 70 px — a chip could not be clicked
			 * once the box was entered — and a chip pressed while the page was
			 * ``blockedReason`` wrote text into a disabled field behind the operator's
			 * back.
			 */}
			{run.enabled && !about && !live && !run.draft ? (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{EXAMPLES.map((example) => (
						<Button
							key={example}
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={() => {
								run.setDraft(example);
								textareaRef.current?.focus();
							}}
						>
							{example}
						</Button>
					))}
				</div>
			) : null}
			<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
				<Button
					variant="primary"
					disabled={disabled || !run.draft.trim()}
					onClick={send}
				>
					{/*
					 * ONE VERB FOR ONE ACTION (design review round 1, N2): the detail
					 * pane's button and this one are the same act, and they used to read
					 * "Ask for a change" and "Ask for this change".
					 */}
					{run.starting ? "Starting…" : "Ask for a change"}
				</Button>
				{blockedReason ? (
					<p className="text-meta text-warning">{blockedReason}</p>
				) : null}
				{/*
				 * The one line the operator needs in order to trust this control. It is
				 * not decoration: the page already hands work to a conversation from
				 * "New chat", and without this sentence the reasonable reading of the box
				 * is that it does the same.
				 */}
				<p id="config-composer-note" className="text-meta text-ink-muted">
					{run.enabled
						? "Runs in the background. This does not appear in your conversation."
						: run.disabledReason}
				</p>
			</div>
		</div>
	);
}
