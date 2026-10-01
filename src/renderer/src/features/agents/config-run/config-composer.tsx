/**
 * The conversational configuration surface: the composer, the run strip, and the
 * settled summary.
 *
 * THE BOX IS THE APP'S OWN COMPOSER, AND THAT IS THE BRIEF THIS FILE NOW KEEPS.
 * `docs/design/agents-inplace-shared-composer.md` (§1.5) supersedes the older
 * "must never read as one: no slash dispatch, no attachments, no draft store"
 * prohibition this header used to carry. What survives from it is the part that
 * was ever the point:
 *
 *  - the SEND PATH is unchanged — `sessions.create{purpose}` + `sessions.message`
 *    on the RUN's id, through `desktopResult` directly, so the run never becomes a
 *    canonical session row;
 *  - NOTHING TYPED HERE ENTERS THE MAIN CONVERSATION, and the box says so in one
 *    standing line — "Runs in the background. This does not appear in your
 *    conversation." — which is a permanent node the box itself describes itself
 *    with, not a placeholder;
 *  - NO ROUTE CHANGE: there is nowhere for this text to navigate to.
 *
 * What is retired is the CONTROL-SURFACE prohibition: `MessageInput` is mounted
 * here, with speech, attachments and the model/effort readings. The two command
 * write paths stay closed by PROPS rather than by the box being different — no
 * `onSlashCommand` and no `mentionsEnabled`, so `slash.available &&
 * Boolean(onSlashCommand)` is false and the picker registry is unreachable — and
 * the send carries its attachments to the wire rather than dropping them.
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

import {
	MessageInput,
	type MessageInputHandle,
	type MessageInputProps,
} from "@shared/components/composer";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { ChevronDown, ChevronRight, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfigRunHandle } from "./use-config-run";

/**
 * Nothing above this box is a transcript.
 *
 * THE RUN'S SURFACE IS ITS OWN STRIP, NOT A CONVERSATION (B1, §3.1): the activity
 * rows, the Watch disclosure, Stop and the settled summary all render above the
 * box, and the composer must not claim them as messages. An empty list is what a
 * mount with no transcript passes, and `transcriptless` below keeps the chat's
 * empty-pane splash off the page.
 */
const EMPTY_MESSAGES: MessageInputProps["messages"] = [];

/**
 * The id the aside sentence carries, so the box can name it in
 * `aria-describedby` (the host-notice slot hands both halves over together).
 */
const ASIDE_NOTICE_ID = "config-composer-note";

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
	const inputRef = useRef<MessageInputHandle | null>(null);
	const stripObserver = useRef<ResizeObserver | null>(null);
	const recordingProbe = useRadientCredentialProbe();
	/*
	 * THE BOX'S CONVERSATION KEY, present from the FIRST PAINT and never re-minted.
	 *
	 * WHY IT IS NOT A SESSION ID: the composer refuses to submit without a key and
	 * stores its text under it, while a run's session exists only after the create
	 * answers — and the key must not move when it does, or a send that failed after
	 * the create would put the text back into a key the box is no longer reading.
	 * So the key is the run composer's OWN identity (the design's "the run's
	 * identity, which is deliberately not a session", §1.4), minted once per page
	 * mount, and the run never becomes a canonical row under it.
	 */
	const [boxKey] = useState(() => `agents-config:${crypto.randomUUID()}`);
	/** The composer owns the box's text; this writes into the same key it reads. */
	const setBoxText = (value: string) =>
		useConversationInputStore.getState().setCurrentInput(boxKey, value);
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
	/*
	 * THE BOX NO LONGER GOES DEAD WHILE A RUN IS LIVE, and that is deliberate: the
	 * shared composer is a real composer, and the run's Stop lives on the strip
	 * above it (B1). A second send during a live run is answered by the backend's
	 * own single-flight rule — a 409 carrying the active run's id, which is the
	 * attach path below — so the refused keystroke was never what kept the run
	 * single. `disabled` survives for the states that really cannot send anything.
	 */
	const disabled = !run.enabled || Boolean(blockedReason);
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
		inputRef.current?.focusInput();
	}, [aboutKey]);

	/**
	 * DISMISS AND CLEAR PUT THE CARET BACK (UX U8). Both retire the control the
	 * operator just pressed, and focus used to fall to `body` — a keyboard user
	 * then had no cursor anywhere on the page.
	 */
	const dismissAndFocus = () => {
		run.dismiss();
		inputRef.current?.focusInput();
	};
	const clearAboutAndFocus = () => {
		onClearAbout();
		inputRef.current?.focusInput();
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
			{/*
			 * THE BOX IS THE APP'S OWN COMPOSER (Scope B, §3.1).
			 *
			 * WHAT IT REPLACES: the bespoke `<Textarea>` and its own Send button, and
			 * nothing else. The run keeps the surface above it — `RunStrip`, Watch,
			 * Stop, `RunSummary` — because that is the run's progress vocabulary and
			 * not a transcript (§3.1's two-surface reading); this is one shared box
			 * with speech, attachments and the model/effort readings the page never
			 * had, not a second composer.
			 *
			 * THE FOUR DIFFERENCES ARE ALL PROPS, none of them a fork (§3.3):
			 * `transcriptless` (no transcript above it), no `onSlashCommand` and no
			 * `mentionsEnabled` (the command write paths stay closed), the readings
			 * without a dispatcher (each picker renders with the shipped
			 * `COMMANDS_OFF` sentence), and the aside sentence in the notice band
			 * below, where the box can still describe itself with it.
			 */}
			<MessageInput
				ref={inputRef}
				conversationId={boxKey}
				messages={EMPTY_MESSAGES}
				/*
				 * `isLoading` IS FALSE AND STAYS FALSE: it is the only prop that swaps
				 * Send for Stop and disables the box, and this page's Stop is the
				 * strip's (`run.stop`), which keeps running beside the box.
				 */
				isLoading={false}
				transcriptless
				placeholderOverride={placeholder}
				/*
				 * READINGS WITHOUT PICKERS (§3.3.3(b)): the snapshot renders the model,
				 * effort, context, spend and duration the run really is on, and no
				 * `onCommand` means none of them opens a picker — because this run's
				 * model and effort are resolved by the backend, not chosen here.
				 */
				sessionStatus={run.frontend ? { frontend: run.frontend } : undefined}
				recordingProbe={recordingProbe}
				hostNotice={{
					id: ASIDE_NOTICE_ID,
					/*
					 * THE PAGE'S OWN GATE REACHES THE BOX (code review round 1, M1): a
					 * dirty edit elsewhere on the page (`blockedReason`) and a backend
					 * without the capability both refuse input here, through the same
					 * `isInputDisabled` term every writer and submitter reads. It used
					 * to gate only the example chips, so the operator could type a
					 * request the page would then refuse to send.
					 *
					 * NOT `unavailable`: that prop is chat's "this conversation is not
					 * on this machine" state, and it would put chat's copy and a
					 * transcript-only notice id on this page (m1).
					 */
					blocksInput: !run.enabled || Boolean(blockedReason),
					node: (
						/*
						 * THE STANDING SENTENCE, verbatim and permanent — not a
						 * placeholder and not an invitation (U4): the page already hands
						 * work to a conversation from "New chat", and without this line the
						 * reasonable reading of the box is that it does the same.
						 */
						<p
							id={ASIDE_NOTICE_ID}
							data-testid="config-composer-note"
							className="text-meta text-ink-muted"
						>
							{run.enabled
								? "Runs in the background. This does not appear in your conversation."
								: run.disabledReason}
						</p>
					),
				}}
				/*
				 * THE SEND SEAM, AND THE DRAFT RULE THAT SURVIVES THROUGH IT: `false`
				 * means the request never reached the run, so the composer puts the text
				 * (and its chips) back rather than spending them (§3.3.1).
				 */
				onSendMessage={(content, attachments) =>
					run.start(content, about, attachments)
				}
			/>
			{/*
			 * THE CHIPS STAY WHILE THE BOX IS FOCUSED, and they are disabled with it
			 * (design review round 1, D4/U11 and D9). They write through the SAME store
			 * the box reads, keyed by its conversation id — the composer owns the text
			 * now, so a chip that wrote anywhere else would type into a box nobody is
			 * looking at.
			 */}
			{run.enabled && !about && !live ? (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{EXAMPLES.map((example) => (
						<Button
							key={example}
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={() => {
								setBoxText(example);
								inputRef.current?.focusInput();
							}}
						>
							{example}
						</Button>
					))}
				</div>
			) : null}
			{blockedReason ? (
				<p className="mt-2 text-meta text-warning">{blockedReason}</p>
			) : null}
		</div>
	);
}
