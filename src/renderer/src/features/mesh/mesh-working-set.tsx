/**
 * The move dialog's WORKING-SET REVIEW: what a mid-conversation move sends to the
 * destination device, what it withholds, and what stays behind.
 *
 * WHY THIS EXISTS (operator request, 2026-11-18): a move used to carry the
 * conversation and nothing else, so a user could move a session to another device
 * and only then find that its worktrees, unpushed commits and uncommitted files
 * were still on the first one. The core now carries that working set (design
 * `docs/design/move-working-set.md` in local-operator), and the operator asked for
 * the popup to say so and to require the user's explicit approval - "make sure
 * that the user is confident that the destination device should receive the
 * files". This panel is that statement and that approval.
 *
 * WHAT IT SHOWS, and why each part is here:
 *   - the warning naming the destination DEVICE, because the consent is to a
 *     specific device and the name is what the user recognises;
 *   - each worktree that will be sent (path, branch, unpushed/staged/unstaged/
 *     untracked counts), the total size, and any auto-clone from origin with its
 *     estimated size (manager decision Q1: a clone is listed and confirmed, never
 *     silent);
 *   - what is WITHHELD (secret-shaped paths; worktrees whose unpushed history
 *     carries secret-shaped material, with the remedy). There is deliberately no
 *     opt-in to send a withheld worktree in v1 (manager scope decision): the user
 *     fixes the history and moves again;
 *   - what stays behind (dependency trees, build output) with the recipe that
 *     recreates it on arrival.
 *
 * SEND OR STAY IS THE BACKEND'S FACT (`carries_files`), never assumed: the first
 * core release gates the move on this consent but leaves the files on the
 * source, and there the review says the destination will NOT have them. See
 * `WorkingSetMode` for the three consents (send / leave / without).
 *
 * WHAT IT DOES NOT SHOW: file lists or contents. The preflight is metadata only;
 * the consent is to the SCOPE (which trees, which device, what is withheld), which
 * is exactly what the `scope_digest` the transfer echoes binds.
 *
 * Every sentence is composed here from the manifest's codes and numbers via
 * `t()`: the core block carries no English beyond paths and commands (§3.4, §12).
 *
 * THE DESTINATION PROBE (`session_transfer_working_set_probe`, §11.1a). The
 * coordinator's live move confirmed rows that all said "pending_destination", and
 * the destination then could neither fetch the SSH remote nor push the HTTPS one.
 * The core now asks the destination BEFORE the user confirms, so each row says
 * whether that device can reach its remote, why not (a FIXED probe code mapped
 * to a sentence here - never git's raw stderr, which is peer-authored text), the
 * HTTPS alternative when only SSH failed, and the exact command that grants
 * access (copyable, because it must be run on ANOTHER device; only the two
 * command shapes the core emits survive the parser). Missing toolchains and a
 * missing Team Bridge enrolment are advisory: the core never blocks on them, so
 * neither does the checkbox, and they share ONE quiet info note so the
 * destination warning stays the dialog's only warning (design round 1, D4).
 * Without the capability none of it renders.
 *
 * LAYOUT (design D1 / UX U1). The dialog caps its height and only the middle
 * scrolls: the destination warning (`WorkingSetWarning`) sits above the scroll
 * region and the confidence checkbox (`WorkingSetConsent`) below it, so the
 * consent and Confirm are never below the fold however long the list is.
 */

import { CopyButton } from "@shared/components/common/copy-button";
import { Alert, Checkbox } from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { AlertTriangle, Check, FolderGit2, Info } from "lucide-react";
import type { FC, ReactNode } from "react";
import { formatBytes, formatList } from "../../../../i18n/format";
import { t } from "../../../../i18n/messages";
import type {
	WorkingSet,
	WorkingSetExclusion,
	WorkingSetLeftBehind,
	WorkingSetWorktree,
} from "./mesh-types";

/**
 * Why a worktree is not sent, with its remedy, from the core's reason code.
 *
 * ONE SENTENCE PER CODE in §3.4's enum, and a code this build does not know falls
 * to a sentence that still NAMES it: a reason the user cannot read is better
 * shown verbatim than dropped, because "not sent" without a why is the very
 * surprise this panel exists to prevent.
 */
export function leftBehindReason(
	reason: string | null,
	mode: WorkingSetMode = "send",
): string {
	if (mode !== "send" && reason && reason in STAY_REASON)
		return STAY_REASON[reason]();
	switch (reason) {
		case "contended":
			return t("ui.mesh.mesh_actions.working_set_reason_contended");
		case "outside_home":
			return t("ui.mesh.mesh_actions.working_set_reason_outside_home");
		case "unmerged":
			return t("ui.mesh.mesh_actions.working_set_reason_unmerged");
		case "in_progress_operation":
			return t("ui.mesh.mesh_actions.working_set_reason_in_progress_operation");
		case "submodule":
			return t("ui.mesh.mesh_actions.working_set_reason_submodule");
		case "lfs":
			return t("ui.mesh.mesh_actions.working_set_reason_lfs");
		case "history_secret":
			return t("ui.mesh.mesh_actions.working_set_reason_history_secret");
		case "history_unscanned":
			return t("ui.mesh.mesh_actions.working_set_reason_history_unscanned");
		case "over_cap":
			return t("ui.mesh.mesh_actions.working_set_reason_over_cap");
		case "destination_cannot_clone":
			return t(
				"ui.mesh.mesh_actions.working_set_reason_destination_cannot_clone",
			);
		case "not_transferred":
			return t("ui.mesh.mesh_actions.working_set_reason_not_transferred");
		case "destination_conflict":
			return t("ui.mesh.mesh_actions.working_set_reason_destination_conflict");
		case "unsupported_by_peer":
			return t("ui.mesh.mesh_actions.working_set_reason_unsupported_by_peer");
		default:
			return t("ui.mesh.mesh_actions.working_set_reason_unknown", {
				code: reason ?? "",
			});
	}
}

/*
 * THE SAME REASONS WHEN NOTHING MOVES (UX round 1, U7). In `leave`/`without`
 * mode no move carries files, so a remedy ending "…then move again" promises a
 * second move that would carry nothing either. These say only the cause.
 */
const STAY_REASON: Record<string, () => string> = {
	unmerged: () => t("ui.mesh.mesh_actions.working_set_reason_unmerged_stay"),
	in_progress_operation: () =>
		t("ui.mesh.mesh_actions.working_set_reason_in_progress_operation_stay"),
	history_secret: () =>
		t("ui.mesh.mesh_actions.working_set_reason_history_secret_stay"),
	history_unscanned: () =>
		t("ui.mesh.mesh_actions.working_set_reason_history_unscanned_stay"),
	over_cap: () => t("ui.mesh.mesh_actions.working_set_reason_over_cap_stay"),
	destination_cannot_clone: () =>
		t("ui.mesh.mesh_actions.working_set_reason_destination_cannot_clone_stay"),
	unsupported_by_peer: () =>
		t("ui.mesh.mesh_actions.working_set_reason_unsupported_by_peer_stay"),
};

/** Why one path is withheld, from §3.4's `excluded[].why` enum. */
export function exclusionReason(why: string): string {
	switch (why) {
		case "secret_path":
			return t("ui.mesh.mesh_actions.working_set_withheld_secret_path");
		case "secret_content":
			return t("ui.mesh.mesh_actions.working_set_withheld_secret_content");
		case "history_secret_path":
			return t("ui.mesh.mesh_actions.working_set_withheld_history_secret_path");
		case "history_secret_content":
			return t(
				"ui.mesh.mesh_actions.working_set_withheld_history_secret_content",
			);
		/*
		 * An unknown code NAMES the code (agent review round 1, R5), as
		 * `leftBehindReason` does: claiming "looks like a secret" for a reason this
		 * build cannot read would be a false statement inside the consent.
		 */
		default:
			return t("ui.mesh.mesh_actions.working_set_reason_unknown", {
				code: why,
			});
	}
}

/** What kind of thing stays behind, from §3.4's `left_behind[].kind` enum. */
function leftBehindKind(kind: string): string {
	switch (kind) {
		case "dependency_tree":
			return t("ui.mesh.mesh_actions.working_set_kind_dependency_tree");
		case "build_output":
			return t("ui.mesh.mesh_actions.working_set_kind_build_output");
		case "ignored":
			return t("ui.mesh.mesh_actions.working_set_kind_ignored");
		default:
			return t("ui.mesh.mesh_actions.working_set_kind_loose_file");
	}
}

/**
 * The worktrees that WILL be sent versus the ones withheld with a reason.
 *
 * ONLY `planned` IS PROMISED AS SENT (agent review round 1, R5): it is the one
 * state a preflight - and a refusal's fresh manifest, which is a preflight -
 * uses for a tree that travels. Any other state (`left_behind`, or one a newer
 * core adds) is listed as withheld under its reason, or its state when it has
 * none, so a code this build cannot read is never turned into "will be sent".
 */
export function partitionWorktrees(set: WorkingSet): {
	sent: WorkingSetWorktree[];
	withheld: WorkingSetWorktree[];
} {
	const sent: WorkingSetWorktree[] = [];
	const withheld: WorkingSetWorktree[] = [];
	for (const tree of set.worktrees) {
		(tree.state === "planned" ? sent : withheld).push(tree);
	}
	return { sent, withheld };
}

/*
 * `overflow-wrap:anywhere`, not `break-all` (design round 1, D7): a path or
 * command wraps at its separators where it fits and breaks inside a token only
 * when that token alone is wider than the dialog.
 */
const mono = "min-w-0 font-mono text-meta text-ink [overflow-wrap:anywhere]";

/**
 * The probe answers that are a problem the user can act on before confirming.
 * `no_remote` and `unknown_destination` are information, not failures: the first
 * has nothing to reach, the second could not be asked (an older lop there).
 */
const PROBE_FAILURES: ReadonlySet<string> = new Set([
	"destination_cannot_fetch",
	"destination_cannot_push",
	"destination_cannot_clone",
]);

/**
 * Why the destination's probe failed, from the core's FIXED `clone_detail` code.
 *
 * WHY A TABLE AND NOT THE TEXT. The first core revision sent git's first stderr
 * line; core #4241's remediation replaced it with fixed codes, and the parser
 * (`probeDetailOf`) already drops anything that is not code-shaped. A code this
 * build does not know still gets a sentence that NAMES it, the way
 * `leftBehindReason` does, so a newer core's reason is never silently lost.
 */
const PROBE_DETAIL: Record<string, (device: string) => string> = {
	// core `network/workset_probe.py` DETAIL_CODES (#4241 @ ca98f378922f).
	auth_denied: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_auth_denied", { device }),
	not_found: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_not_found", { device }),
	unreachable: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_unreachable", { device }),
	tls: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_tls", { device }),
	host_key: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_host_key", { device }),
	host_refused: () =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_host_refused"),
	error: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_error", { device }),
	url_refused: () =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_url_refused"),
	git_missing: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_git_missing", { device }),
	timeout: () => t("ui.mesh.mesh_actions.working_set_probe_detail_timeout"),
	probe_error: (device) =>
		t("ui.mesh.mesh_actions.working_set_probe_detail_probe_error", { device }),
};

/*
 * `run_on` AS A DEVICE NAME, or `null` for the role token the core sends when it
 * cannot name one (`lending_device`). Peer text: a strict name charset, so the
 * sentence can never carry markup-looking or multi-line content.
 */
const DEVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,63}$/u;

export function remedyDevice(runOn: string): string | null {
	if (!runOn || runOn === "lending_device") return null;
	return DEVICE_NAME.test(runOn) ? runOn : null;
}

export function probeDetailSentence(code: string, device: string): string {
	const known = PROBE_DETAIL[code];
	return known
		? known(device)
		: t("ui.mesh.mesh_actions.working_set_probe_detail_unknown", {
				device,
				code,
			});
}

/** One row's reachability sentence, or `null` when there is nothing to say. */
export function probeSentence(
	check: string | null,
	device: string,
	remote: string,
): string | null {
	switch (check) {
		case "ok":
			return t("ui.mesh.mesh_actions.working_set_probe_ok", { device });
		case "destination_cannot_fetch":
			return t("ui.mesh.mesh_actions.working_set_probe_cannot_fetch", {
				device,
				remote,
			});
		case "destination_cannot_push":
			return t("ui.mesh.mesh_actions.working_set_probe_cannot_push", {
				device,
				remote,
			});
		case "destination_cannot_clone":
			return t("ui.mesh.mesh_actions.working_set_probe_cannot_clone", {
				device,
				remote,
			});
		case "no_remote":
			return t("ui.mesh.mesh_actions.working_set_probe_no_remote", { device });
		/*
		 * `unknown_destination` is said ONCE for the whole list (the block's
		 * `destination_probe.state`), and `pending_destination` keeps the pre-probe
		 * clone note: repeating either on every row would bury the rows' own facts.
		 */
		default:
			return null;
	}
}

/** The destination's answer for one worktree, under its counts. */
const ProbeLines: FC<{
	tree: WorkingSetWorktree;
	device: string;
	/** Tools the block-level note already lists: not repeated on the row (D4). */
	listedTools: ReadonlySet<string>;
}> = ({ tree, device, listedTools }) => {
	const check = tree.cloneCheck ?? "";
	const rowTools = tree.missingTools.filter((tool) => !listedTools.has(tool));
	const sentence = probeSentence(check, device, tree.remoteUrl ?? tree.repo);
	const failed = PROBE_FAILURES.has(check);
	const Icon = failed ? AlertTriangle : check === "ok" ? Check : Info;
	return (
		<>
			{sentence && (
				<span
					className={cn(
						"flex items-start gap-1.5 ps-5 text-meta",
						failed ? "text-warning" : "text-ink-dim",
					)}
					data-probe={check}
				>
					<Icon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
					<span className="min-w-0 break-words">{sentence}</span>
				</span>
			)}
			{failed && tree.cloneDetail && (
				<span
					className="ps-5 text-meta text-ink-dim"
					data-probe-detail={tree.cloneDetail}
				>
					{probeDetailSentence(tree.cloneDetail, device)}
				</span>
			)}
			{tree.httpsRewrite && (
				<span className="ps-5 text-meta text-ink-dim [overflow-wrap:anywhere]">
					{t("ui.mesh.mesh_actions.working_set_probe_https_rewrite", {
						device,
						url: tree.httpsRewrite.url,
					})}
				</span>
			)}
			{tree.remedy && (
				<span className="flex flex-col gap-1 ps-5" data-probe-remedy>
					<span className="text-meta text-ink-dim">
						{/*
						 * WHICH DEVICE RUNS IT (UX round 1, U5): `run_on` names it when the
						 * core knows the device; when it is only the role
						 * (`lending_device`), the sentence names the device the access is
						 * FOR and the role of the one that runs it - an existing share
						 * (`include`) or a device signed in to GitHub (`share`).
						 */}
						{remedyDevice(tree.remedy.runOn)
							? t("ui.mesh.mesh_actions.working_set_probe_remedy_on", {
									lender: remedyDevice(tree.remedy.runOn) ?? "",
								})
							: tree.remedy.kind === "include"
								? t("ui.mesh.mesh_actions.working_set_probe_remedy_include", {
										device,
									})
								: t("ui.mesh.mesh_actions.working_set_probe_remedy_share", {
										device,
									})}
					</span>
					<span className="flex items-center gap-2">
						<code className={cn(mono, "min-w-0 flex-1")}>
							{tree.remedy.command}
						</code>
						<CopyButton
							value={tree.remedy.command}
							label={t("ui.mesh.mesh_actions.working_set_probe_copy")}
						/>
					</span>
				</span>
			)}
			{rowTools.length > 0 && (
				<span className="ps-5 text-meta text-warning">
					{t("ui.mesh.mesh_actions.working_set_row_missing_tools", {
						device,
						tools: formatList(rowTools),
					})}
				</span>
			)}
		</>
	);
};

/**
 * The block-level prerequisites and the "could not check" note, as ONE quiet
 * info note (design round 1, D4): they are advisory - the core never blocks on
 * them, and neither do the checkbox and Confirm - so they must not wear the
 * destination warning's weight or push the list below it.
 */
const ProbeNotices: FC<{ set: WorkingSet; device: string }> = ({
	set,
	device,
}) => {
	const probe = set.destinationProbe;
	if (!probe) return null;
	const bridge = probe.teamBridge;
	const unknown = probe.state === "unknown_destination";
	const tools = probe.missingTools.length > 0;
	const unenrolled = bridge !== null && !bridge.enrolled;
	if (!unknown && !tools && !unenrolled) return null;
	return (
		<Alert variant="info" className="text-meta" data-probe="notes">
			<span className="flex flex-col gap-1.5">
				{unknown && (
					<span data-probe="unknown">
						{t("ui.mesh.mesh_actions.working_set_probe_unknown", { device })}
					</span>
				)}
				{tools && (
					<span data-probe="missing-tools">
						{t("ui.mesh.mesh_actions.working_set_missing_tools", { device })}{" "}
						<span className="font-mono">{formatList(probe.missingTools)}</span>
					</span>
				)}
				{unenrolled && (
					<span data-probe="team-bridge">
						{t("ui.mesh.mesh_actions.working_set_team_bridge", { device })}
					</span>
				)}
			</span>
		</Alert>
	);
};

/**
 * A row's change counts, ZERO TERMS OMITTED (design round 1, D8): "0 staged · 0
 * untracked" is noise that wraps the row; a clean tree shows just its branch.
 */
function worktreeCounts(tree: WorkingSetWorktree): string[] {
	const parts: string[] = [];
	if (tree.unpushedCommits > 0)
		parts.push(
			t("ui.mesh.mesh_actions.working_set_count_unpushed", {
				count: tree.unpushedCommits,
			}),
		);
	if (tree.staged > 0)
		parts.push(
			t("ui.mesh.mesh_actions.working_set_count_staged", {
				count: tree.staged,
			}),
		);
	if (tree.unstaged > 0)
		parts.push(
			t("ui.mesh.mesh_actions.working_set_count_unstaged", {
				count: tree.unstaged,
			}),
		);
	if (tree.untracked > 0)
		parts.push(
			t("ui.mesh.mesh_actions.working_set_count_untracked", {
				count: tree.untracked,
			}),
		);
	return parts;
}

const WorktreeRow: FC<{
	tree: WorkingSetWorktree;
	device: string;
	/** Clone notes only make sense when the files are actually sent. */
	showClone: boolean;
	/** This row carries its repository's one "cloned if missing" note. */
	clonePending: boolean;
	/** The backend serves the destination probe: render its per-row answer. */
	probe: boolean;
	listedTools: ReadonlySet<string>;
}> = ({ tree, device, showClone, clonePending, probe, listedTools }) => (
	<li className="flex flex-col gap-0.5 py-1.5">
		<span className="flex items-start gap-1.5">
			<FolderGit2
				aria-hidden="true"
				className="mt-0.5 size-3.5 shrink-0 text-ink-dim"
			/>
			<span className={mono}>{tree.path}</span>
		</span>
		<span className="ps-5 text-meta text-ink-dim">
			{[
				tree.branch ?? t("ui.mesh.mesh_actions.working_set_detached"),
				...worktreeCounts(tree),
				...(tree.bytes > 0 ? [formatBytes(tree.bytes)] : []),
			].join(" · ")}
		</span>
		{tree.destPath && tree.destPath !== tree.path && (
			<span className="ps-5 text-meta text-ink-dim">
				{t("ui.mesh.mesh_actions.working_set_dest_path", {
					path: tree.destPath,
				})}
			</span>
		)}
		{showClone && clonePending && !tree.clone && (
			<span className="ps-5 text-meta text-ink-dim">
				{t("ui.mesh.mesh_actions.working_set_clone_pending", {
					device,
					url: tree.remoteUrl ?? "",
				})}
			</span>
		)}
		{showClone && tree.clone && (
			<span className="ps-5 text-meta text-ink-dim">
				{tree.clone.bytes !== null
					? t("ui.mesh.mesh_actions.working_set_clone_sized", {
							device,
							url: tree.clone.url || tree.repo,
							size: formatBytes(tree.clone.bytes),
						})
					: t("ui.mesh.mesh_actions.working_set_clone", {
							device,
							url: tree.clone.url || tree.repo,
						})}
			</span>
		)}
		{probe && (
			<ProbeLines tree={tree} device={device} listedTools={listedTools} />
		)}
	</li>
);

const WithheldTreeRow: FC<{
	tree: WorkingSetWorktree;
	mode: WorkingSetMode;
}> = ({ tree, mode }) => (
	<li className="flex flex-col gap-0.5 py-1">
		<span className={mono}>{tree.path}</span>
		<span className="text-meta text-ink-muted">
			{leftBehindReason(
				tree.reason ?? (tree.state === "left_behind" ? null : tree.state),
				mode,
			)}
		</span>
	</li>
);

const ExclusionRow: FC<{ row: WorkingSetExclusion }> = ({ row }) => (
	<li className="flex flex-col gap-0.5 py-1">
		<span className={mono}>{row.path}</span>
		<span className="text-meta text-ink-muted">{exclusionReason(row.why)}</span>
	</li>
);

const LeftBehindRow: FC<{ row: WorkingSetLeftBehind }> = ({ row }) => (
	<li className="flex flex-col gap-0.5 py-1">
		<span className={mono}>{row.path}</span>
		<span className="text-meta text-ink-dim">
			{leftBehindKind(row.kind)}
			{row.recipe && (
				<>
					{" · "}
					{t("ui.mesh.mesh_actions.working_set_recreate_with", {
						command: row.recipe.run,
					})}
				</>
			)}
		</span>
	</li>
);

const Section: FC<{ heading: string; children: ReactNode }> = ({
	heading,
	children,
}) => (
	<section className="flex flex-col gap-0.5">
		<h3 className="text-meta font-medium text-ink-muted">{heading}</h3>
		<ul className="m-0 list-none divide-y divide-hairline p-0">{children}</ul>
	</section>
);

/**
 * Which consent the review asks for, and so which sentences it says.
 *
 *   - `send`: the backend carries the files (`carries_files: true`); the warning
 *     says ALL working files go to the destination and the box is the operator's
 *     "I'm confident <device> should receive these files". Sends the digest.
 *   - `leave`: the backend gates the move on consent but does NOT send the files
 *     yet (`carries_files: false`, the first core release). Saying "will be sent"
 *     there would be the false promise this feature exists to remove, so the
 *     warning says the conversation on the destination will NOT have them and the
 *     box confirms that. Also sends the digest: the consent is to the same scope.
 *   - `without`: the files cannot travel at all (an `unsupported` manifest, or a
 *     `working_set_unknown` refusal whose owner could not compute one). The only
 *     way forward is the explicit `without_working_set` consent.
 */
export type WorkingSetMode = "send" | "leave" | "without";

/** The mode a manifest asks for; `withoutOnly` is a refusal's verdict. */
export function workingSetMode(
	set: WorkingSet | null,
	withoutOnly: boolean,
): WorkingSetMode {
	if (withoutOnly || set === null || set.state === "unsupported")
		return "without";
	return set.carriesFiles ? "send" : "leave";
}

/**
 * The review's PINNED TOP: why it is asking again (if it is) and the destination
 * warning. Rendered above the dialog's scroll region so the one sentence the
 * consent is about never scrolls away (design D1 / UX U1), and the ONLY
 * `warning` alert in the review (design D4).
 */
export const WorkingSetWarning: FC<{
	workingSet: WorkingSet | null;
	mode: WorkingSetMode;
	/** The destination device's display name, as the warning says it. */
	device: string;
	/**
	 * Why the dialog came back: `changed` (the list moved after the tick) or
	 * `unconfirmed` (the route refused a move that carried no reviewed list).
	 */
	notice: "changed" | "unconfirmed" | null;
}> = ({ workingSet, mode, device, notice }) => {
	useI18nLocale();
	const warning =
		mode === "send"
			? t("ui.mesh.mesh_actions.working_set_warning", { device })
			: mode === "leave"
				? t("ui.mesh.mesh_actions.working_set_warning_leave", { device })
				: workingSet
					? t("ui.mesh.mesh_actions.working_set_warning_without", { device })
					: t("ui.mesh.mesh_actions.working_set_unknown", { device });
	return (
		<div className="flex shrink-0 flex-col gap-3" data-testid="working-set">
			{notice && (
				<Alert variant="info" className="text-meta" data-notice={notice}>
					{notice === "changed"
						? t("ui.mesh.mesh_actions.working_set_changed")
						: t("ui.mesh.mesh_actions.working_set_unconfirmed")}
				</Alert>
			)}
			<Alert variant="warning" className="text-meta" data-mode={mode}>
				{warning}
			</Alert>
		</div>
	);
};

/**
 * The review's SCROLLING MIDDLE: advisory probe notes and the lists. It owns no
 * scroll of its own - the dialog's body region is the single scroll container,
 * because a capped list nested inside a scrolling dialog is two scrollbars and
 * the withheld rows hide below the inner one (design D9).
 */
export const WorkingSetDetails: FC<{
	workingSet: WorkingSet;
	mode: WorkingSetMode;
	device: string;
	/**
	 * `features.session_transfer_working_set_probe`: render the destination's
	 * reachability and prerequisite answers. False renders exactly the pre-probe
	 * review even if a block happens to carry the fields.
	 */
	probe?: boolean;
}> = ({ workingSet, mode, device, probe = false }) => {
	useI18nLocale();
	const { sent, withheld } = partitionWorktrees(workingSet);
	/*
	 * A ROW REPEATS NO TOOL THE BLOCK NOTE ALREADY LISTS (design D4): the note
	 * names the destination's missing toolchains once; a row keeps its own line
	 * only for a tool the note does not carry.
	 */
	const listedTools: ReadonlySet<string> = new Set(
		probe ? (workingSet.destinationProbe?.missingTools ?? []) : [],
	);
	/*
	 * ONE CLONE NOTE PER REPOSITORY, not per row: whether the destination must
	 * clone the primary is one question per repository (`clone_check:
	 * pending_destination` is the destination's answer, not yet known), and six
	 * worktrees of one repo repeating it would bury the rows' own facts.
	 */
	const cloneNoted = new Set<string>();
	return (
		<div className="flex flex-col gap-3" data-testid="working-set-details">
			{probe && <ProbeNotices set={workingSet} device={device} />}
			{sent.length > 0 && (
				<Section
					heading={
						mode === "send"
							? t("ui.mesh.mesh_actions.working_set_sent_heading", {
									count: sent.length,
									size: formatBytes(workingSet.totals.bytes),
								})
							: /*
								 * WHERE THEY STAY is a device the user recognises when the
								 * block names it (`source`): "stays where it is" is ambiguous
								 * from the destination's side of a recall.
								 */
								workingSet.source
								? t("ui.mesh.mesh_actions.working_set_kept_heading_on", {
										count: sent.length,
										source: workingSet.source.name,
									})
								: t("ui.mesh.mesh_actions.working_set_kept_heading", {
										count: sent.length,
									})
					}
				>
					{sent.map((tree) => {
						/*
						 * The "cloned from origin if missing" note stays for an `ok` probe
						 * (the destination CAN fetch, so a clone would work) and goes for a
						 * failed one, whose own line says why a clone would not.
						 */
						const noteClone =
							mode === "send" &&
							(tree.cloneCheck === "pending_destination" ||
								(probe && tree.cloneCheck === "ok")) &&
							tree.remoteUrl !== null &&
							!cloneNoted.has(tree.repo);
						if (noteClone) cloneNoted.add(tree.repo);
						return (
							<WorktreeRow
								key={tree.path}
								tree={tree}
								device={device}
								showClone={mode === "send"}
								clonePending={noteClone}
								probe={probe}
								listedTools={listedTools}
							/>
						);
					})}
				</Section>
			)}
			{(withheld.length > 0 || workingSet.excluded.length > 0) && (
				<Section
					heading={
						/*
						 * "Withheld - not sent" over a list where NOTHING is sent is a
						 * double negative (design D6b): in files-stay mode the section is
						 * what a working-file move would still leave out.
						 */
						mode === "send"
							? t("ui.mesh.mesh_actions.working_set_withheld_heading")
							: t("ui.mesh.mesh_actions.working_set_withheld_heading_stay")
					}
				>
					{withheld.map((tree) => (
						<WithheldTreeRow key={tree.path} tree={tree} mode={mode} />
					))}
					{workingSet.excluded.map((row) => (
						<ExclusionRow key={`${row.path}:${row.why}`} row={row} />
					))}
				</Section>
			)}
			{workingSet.leftBehind.length > 0 && (
				<Section
					heading={t("ui.mesh.mesh_actions.working_set_left_behind_heading")}
				>
					{workingSet.leftBehind.map((row) => (
						<LeftBehindRow key={row.path} row={row} />
					))}
				</Section>
			)}
		</div>
	);
};

/**
 * The REQUIRED confidence checkbox, pinned below the scroll region.
 *
 * Controlled by the dialog, not here, because the dialog owns the rule it feeds
 * (Confirm disabled until ticked) and the reset it needs (a fresh manifest or a
 * new opening un-ticks it). The ids come from the dialog too: Confirm points
 * `aria-describedby` at the label while the box is unticked, so a screen-reader
 * user hears WHY the button is dimmed (UX U8 / agent review N3).
 */
export const WorkingSetConsent: FC<{
	mode: WorkingSetMode;
	device: string;
	confident: boolean;
	onConfidentChange: (next: boolean) => void;
	disabled: boolean;
	checkboxId: string;
	labelId: string;
}> = ({
	mode,
	device,
	confident,
	onConfidentChange,
	disabled,
	checkboxId,
	labelId,
}) => {
	useI18nLocale();
	return (
		<div
			className="flex shrink-0 items-start gap-2"
			data-testid="working-set-consent"
		>
			<Checkbox
				id={checkboxId}
				checked={confident}
				disabled={disabled}
				aria-required="true"
				onCheckedChange={(next) => onConfidentChange(next === true)}
				className="mt-0.5"
			/>
			<label
				id={labelId}
				htmlFor={checkboxId}
				className="text-body-sm text-ink"
			>
				{mode === "send"
					? t("ui.mesh.mesh_actions.working_set_checkbox", { device })
					: t("ui.mesh.mesh_actions.working_set_checkbox_leave", { device })}
			</label>
		</div>
	);
};
