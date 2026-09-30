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
import { useEffect, useRef, useState } from "react";
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

function RunStrip({ run }: { run: ConfigRunHandle }) {
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
							? "Stopped with an error"
							: "";

	return (
		<div
			className="rounded-md border border-hairline bg-surface px-3 py-2"
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
						<Button variant="ghost" size="sm" onClick={run.dismiss}>
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
			{watching ? (
				<div className="mt-2 border-hairline border-t pt-2">
					<RunActivity run={run} />
				</div>
			) : null}
			{/*
			 * THE STOPPED CASE SAYS WHAT IT KEPT. Cancellation is not rollback: the
			 * tools write through as they go, so a stop mid-run leaves whatever it had
			 * already written, and the honest sentence is the one that says so rather
			 * than implying the machine was put back.
			 */}
			{run.status === "stopped" ? (
				<div className="mt-2 space-y-1 border-hairline border-t pt-2 text-body-sm">
					<p className="text-ink">
						Stopped. Changes it had already made were kept.
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
					<p className="text-meta text-ink-muted">
						Nothing else was changed by this run.
					</p>
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
			<p className="mt-2 border-hairline border-t pt-2 text-body-sm text-ink-muted">
				The run answered without changing any agent or team.
			</p>
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
}: {
	run: ConfigRunHandle;
	hero?: boolean;
	blockedReason?: string | null;
	about: { kind: "agent" | "team"; name: string } | null;
	onClearAbout: () => void;
}) {
	const [focused, setFocused] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const live = run.status === "running" || run.status === "stopping";
	const disabled = !run.enabled || live || Boolean(blockedReason);
	const placeholder = about
		? `Change ${about.name}…`
		: run.enabled
			? "Ask for a new agent or change a team…"
			: "Configure agents by conversation";

	const send = () => {
		const text = run.draft.trim();
		if (!text || disabled) return;
		void run.start(text, about);
	};

	return (
		<div
			className={cn(
				"rounded-md border border-hairline bg-surface p-3",
				hero && "shadow-none",
			)}
			data-testid="config-composer"
		>
			<div className="sr-only" id="config-composer-label">
				Ask for an agent or team change
			</div>
			{run.enabled && run.status !== "idle" ? <RunStrip run={run} /> : null}
			{about ? (
				<div className="mb-2 flex items-center gap-2">
					<Badge variant="accent" data-testid="config-composer-about">
						About {about.kind} {about.name}
					</Badge>
					<Button variant="ghost" size="sm" onClick={onClearAbout}>
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
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onChange={(event) => run.setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						send();
					}
				}}
			/>
			{run.enabled && !about && !live && !focused && !run.draft ? (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{EXAMPLES.map((example) => (
						<Button
							key={example}
							variant="outline"
							size="sm"
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
					{run.starting ? "Starting…" : "Ask for this change"}
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
