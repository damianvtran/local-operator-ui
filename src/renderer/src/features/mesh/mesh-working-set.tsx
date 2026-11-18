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
 * whether that device can reach its remote, with git's own error line, the HTTPS
 * alternative when only SSH failed, and the exact command that grants access
 * (copyable, because it must be run on ANOTHER device). Missing toolchains and a
 * missing Team Bridge enrolment are warnings: the core never blocks on them, so
 * neither does the checkbox. Without the capability none of it renders.
 */

import { CopyButton } from "@shared/components/common/copy-button";
import { Alert, Checkbox } from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { AlertTriangle, Check, FolderGit2, Info } from "lucide-react";
import { type FC, type ReactNode, useId } from "react";
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
export function leftBehindReason(reason: string | null): string {
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
		default:
			return t("ui.mesh.mesh_actions.working_set_withheld_secret_path");
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
 * The worktrees that WILL be sent versus the ones left behind with a reason.
 *
 * `left_behind` is the only state that means "not sent"; every other state the
 * preflight can report (`planned`, and the post-move states a refusal's fresh
 * manifest may echo) is a tree that travels.
 */
export function partitionWorktrees(set: WorkingSet): {
	sent: WorkingSetWorktree[];
	withheld: WorkingSetWorktree[];
} {
	const sent: WorkingSetWorktree[] = [];
	const withheld: WorkingSetWorktree[] = [];
	for (const tree of set.worktrees) {
		(tree.state === "left_behind" ? withheld : sent).push(tree);
	}
	return { sent, withheld };
}

const mono = "font-mono text-meta text-ink break-all";

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
 * The probe's own short codes (`url_refused`, `git_missing`, `timeout`,
 * `probe_error`, an OSError class name). The row's sentence already states what
 * they mean, so only git's real stderr line is shown verbatim under it.
 */
const PROBE_CODE = /^(?:[a-z_]+|[A-Za-z]+Error)$/;

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
const ProbeLines: FC<{ tree: WorkingSetWorktree; device: string }> = ({
	tree,
	device,
}) => {
	const check = tree.cloneCheck ?? "";
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
			{failed && tree.cloneDetail && !PROBE_CODE.test(tree.cloneDetail) && (
				<span className={cn(mono, "ps-5 text-ink-dim")} data-probe-detail>
					{tree.cloneDetail}
				</span>
			)}
			{tree.httpsRewrite && (
				<span className="ps-5 text-meta text-ink-dim break-all">
					{t("ui.mesh.mesh_actions.working_set_probe_https_rewrite", {
						device,
						url: tree.httpsRewrite.url,
					})}
				</span>
			)}
			{tree.remedy && (
				<span className="flex flex-col gap-1 ps-5" data-probe-remedy>
					<span className="text-meta text-ink-dim">
						{t("ui.mesh.mesh_actions.working_set_probe_remedy")}
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
			{tree.missingTools.length > 0 && (
				<span className="ps-5 text-meta text-warning">
					{t("ui.mesh.mesh_actions.working_set_row_missing_tools", {
						device,
						tools: formatList(tree.missingTools),
					})}
				</span>
			)}
		</>
	);
};

/**
 * The block-level prerequisites and the "could not check" note. Warnings, never
 * gates: the checkbox and Confirm do not depend on any of this.
 */
const ProbeNotices: FC<{ set: WorkingSet; device: string }> = ({
	set,
	device,
}) => {
	const probe = set.destinationProbe;
	if (!probe) return null;
	const bridge = probe.teamBridge;
	return (
		<>
			{probe.state === "unknown_destination" && (
				<Alert variant="info" className="text-meta" data-probe="unknown">
					{t("ui.mesh.mesh_actions.working_set_probe_unknown", { device })}
				</Alert>
			)}
			{probe.missingTools.length > 0 && (
				<Alert
					variant="warning"
					className="text-meta"
					data-probe="missing-tools"
				>
					<span className="flex flex-col gap-1">
						{t("ui.mesh.mesh_actions.working_set_missing_tools", { device })}
						<ul className="m-0 list-disc ps-5">
							{probe.missingTools.map((tool) => (
								<li key={tool} className="font-mono">
									{tool}
								</li>
							))}
						</ul>
					</span>
				</Alert>
			)}
			{bridge && !bridge.enrolled && (
				<Alert variant="warning" className="text-meta" data-probe="team-bridge">
					{t("ui.mesh.mesh_actions.working_set_team_bridge", { device })}
				</Alert>
			)}
		</>
	);
};

const WorktreeRow: FC<{
	tree: WorkingSetWorktree;
	device: string;
	/** Clone notes only make sense when the files are actually sent. */
	showClone: boolean;
	/** This row carries its repository's one "cloned if missing" note. */
	clonePending: boolean;
	/** The backend serves the destination probe: render its per-row answer. */
	probe: boolean;
}> = ({ tree, device, showClone, clonePending, probe }) => (
	<li className="flex flex-col gap-0.5 py-1.5">
		<span className="flex items-start gap-1.5">
			<FolderGit2
				aria-hidden="true"
				className="mt-0.5 size-3.5 shrink-0 text-ink-dim"
			/>
			<span className={mono}>{tree.path}</span>
		</span>
		<span className="ps-5 text-meta text-ink-dim">
			{tree.branch ?? t("ui.mesh.mesh_actions.working_set_detached")}
			{" · "}
			{t("ui.mesh.mesh_actions.working_set_worktree_counts", {
				unpushed: tree.unpushedCommits,
				staged: tree.staged,
				unstaged: tree.unstaged,
				untracked: tree.untracked,
			})}
			{tree.bytes > 0 ? ` · ${formatBytes(tree.bytes)}` : ""}
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
		{probe && <ProbeLines tree={tree} device={device} />}
	</li>
);

const WithheldTreeRow: FC<{ tree: WorkingSetWorktree }> = ({ tree }) => (
	<li className="flex flex-col gap-0.5 py-1">
		<span className={mono}>{tree.path}</span>
		<span className="text-meta text-ink-muted">
			{leftBehindReason(tree.reason)}
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
 * The populated review: warning, lists, and the REQUIRED confidence checkbox.
 *
 * The checkbox is controlled by the dialog, not here, because the dialog owns
 * the rule it feeds (Confirm disabled until ticked) and the reset it needs (a
 * fresh manifest un-ticks it). `workingSet` is null only in `without` mode for a
 * manifest the owner could not compute: the warning and the box still render,
 * there is simply no list to show.
 */
export const WorkingSetReview: FC<{
	workingSet: WorkingSet | null;
	mode: WorkingSetMode;
	/** The destination device's display name, as the warning and checkbox say it. */
	device: string;
	confident: boolean;
	onConfidentChange: (next: boolean) => void;
	/** The route refused `working_set_changed`: say why the list is being asked again. */
	changed: boolean;
	disabled: boolean;
	/**
	 * `features.session_transfer_working_set_probe`: render the destination's
	 * reachability and prerequisite answers. False renders exactly the pre-probe
	 * review even if a block happens to carry the fields.
	 */
	probe?: boolean;
}> = ({
	workingSet,
	mode,
	device,
	confident,
	onConfidentChange,
	changed,
	disabled,
	probe = false,
}) => {
	useI18nLocale();
	const checkboxId = useId();
	const { sent, withheld } = workingSet
		? partitionWorktrees(workingSet)
		: { sent: [], withheld: [] };
	const warning =
		mode === "send"
			? t("ui.mesh.mesh_actions.working_set_warning", { device })
			: mode === "leave"
				? t("ui.mesh.mesh_actions.working_set_warning_leave", { device })
				: workingSet
					? t("ui.mesh.mesh_actions.working_set_warning_without", { device })
					: t("ui.mesh.mesh_actions.working_set_unknown", { device });
	/*
	 * ONE CLONE NOTE PER REPOSITORY, not per row: whether the destination must
	 * clone the primary is one question per repository (`clone_check:
	 * pending_destination` is the destination's answer, not yet known), and six
	 * worktrees of one repo repeating it would bury the rows' own facts.
	 */
	const cloneNoted = new Set<string>();
	return (
		<div className="flex min-h-0 flex-col gap-3" data-testid="working-set">
			{changed && (
				<Alert variant="info" className="text-meta">
					{t("ui.mesh.mesh_actions.working_set_changed")}
				</Alert>
			)}
			<Alert variant="warning" className="text-meta" data-mode={mode}>
				{warning}
			</Alert>
			{probe && workingSet && <ProbeNotices set={workingSet} device={device} />}
			{workingSet && (
				<div className="flex max-h-72 min-h-0 flex-col gap-3 overflow-y-auto pe-1">
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
									/>
								);
							})}
						</Section>
					)}
					{(withheld.length > 0 || workingSet.excluded.length > 0) && (
						<Section
							heading={t("ui.mesh.mesh_actions.working_set_withheld_heading")}
						>
							{withheld.map((tree) => (
								<WithheldTreeRow key={tree.path} tree={tree} />
							))}
							{workingSet.excluded.map((row) => (
								<ExclusionRow key={`${row.path}:${row.why}`} row={row} />
							))}
						</Section>
					)}
					{workingSet.leftBehind.length > 0 && (
						<Section
							heading={t(
								"ui.mesh.mesh_actions.working_set_left_behind_heading",
							)}
						>
							{workingSet.leftBehind.map((row) => (
								<LeftBehindRow key={row.path} row={row} />
							))}
						</Section>
					)}
				</div>
			)}
			<div className="flex items-start gap-2">
				<Checkbox
					id={checkboxId}
					checked={confident}
					disabled={disabled}
					onCheckedChange={(next) => onConfidentChange(next === true)}
					className="mt-0.5"
				/>
				<label htmlFor={checkboxId} className="text-body-sm text-ink">
					{mode === "send"
						? t("ui.mesh.mesh_actions.working_set_checkbox", { device })
						: t("ui.mesh.mesh_actions.working_set_checkbox_leave", { device })}
				</label>
			</div>
		</div>
	);
};
