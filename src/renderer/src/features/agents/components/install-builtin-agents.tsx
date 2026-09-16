import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { ReusableProfile } from "@shared/api/local-operator/profile-hooks";
import { Button, Progress } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Layers } from "lucide-react";
import type { FC } from "react";
import { useCallback, useState } from "react";
import {
	type InstallSummary,
	installBuiltins,
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
						variant="secondary"
						className="w-full"
						onClick={() => void run()}
					>
						Install all built-in agents
					</Button>
				) : (
					<button
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
						<span className="shrink-0 font-medium text-accent">Install</span>
					</button>
				))}

			{running && (
				<div
					className={cn("flex flex-col gap-1.5", pad)}
					data-testid="install-builtins-progress"
				>
					<Progress
						value={done}
						max={total}
						aria-label={`Installing built-in agents, ${done} of ${total} done`}
					/>
					{/*
					 * A determinate count and the name in flight, so a slow install
					 * of the fourth agent does not read as a hung first one. The
					 * count is of COMPLETED installs; the name is the one running.
					 */}
					<p aria-live="polite" className="text-meta text-ink-muted">
						{current
							? `Installing ${Math.min(done + 1, total)} of ${total} — ${current}…`
							: `Installing ${done} of ${total}…`}
					</p>
				</div>
			)}

			{summary && (
				<div
					className={cn("flex flex-col gap-1 text-meta", pad)}
					data-testid="install-builtins-summary"
				>
					<p className="flex items-center gap-1.5 text-ink-muted">
						<Check
							className="size-3.5 shrink-0 text-success"
							aria-hidden="true"
						/>
						<span>{summarySentence(summary)}</span>
					</p>
					{/* Only the exceptions get a line each: a batch where everything
					    landed needs one sentence, not six. */}
					{summary.skipped.map((name) => (
						<p key={name} className="text-ink-muted">
							skipped: you have an agent called "{name}"
						</p>
					))}
					{summary.failed.map((failure) => (
						<p key={failure.name} className="text-danger">
							{failure.name}: {failure.message}
						</p>
					))}
					<button
						type="button"
						className="w-fit cursor-pointer text-ink-dim underline"
						onClick={() => setSummary(null)}
					>
						Done
					</button>
				</div>
			)}
		</div>
	);
};
