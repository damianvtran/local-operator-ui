import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { ChevronRight, FileIcon, RotateCw, X } from "lucide-react";
import type { TeamBridgeFilesState } from "./use-team-bridge-files";

/** Filename is authorized message content, never an identifier or markup.
 * Retry/remove keep fixed action labels, while the filename's native disclosure
 * lets pointer and keyboard readers inspect a truncated suffix without losing
 * bidi isolation or copying the name into an action's aria-label. */
export function TeamBridgeFilesStrip({
	state,
}: { state: TeamBridgeFilesState }) {
	if (!state.chips.length) return null;
	return (
		<div className="px-3.5 pt-3">
			<ul
				className="flex flex-wrap gap-2"
				aria-label={t("ui.teamBridge.files.staged")}
			>
				{state.chips.map((chip) => (
					<li
						key={chip.key}
						className="flex w-60 min-w-0 items-center gap-2 rounded-md border border-control bg-sunken p-2"
						data-file-chip={chip.status}
					>
						{chip.status === "uploading" ? (
							<Spinner size="sm" />
						) : (
							<FileIcon
								size={18}
								className={cn(
									"shrink-0",
									/* A failed upload is a state a reader must be able to see, not
									 * only read: both status registers below say the same thing, so a
									 * visual mark keeps them distinguishable (design D5). A chip whose
									 * capability is off is NOT failed — nothing was attempted, and the
									 * explanation sits under the list — so it stays muted. */
									chip.status === "error" && state.enabled
										? "text-danger"
										: "text-ink-muted",
								)}
								aria-hidden="true"
							/>
						)}
						<div className="min-w-0 flex-1">
							{/* A native disclosure works with click, Enter and Space, not
							    hover alone; expanded names wrap inside this same chip. */}
							<details className="group/file-name">
								<summary className="flex min-h-6 cursor-pointer list-none items-start gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 [&::-webkit-details-marker]:hidden">
									<ChevronRight
										size={12}
										aria-hidden="true"
										className="mt-1 shrink-0 text-ink-muted group-open/file-name:rotate-90"
									/>
									<bdi className="block min-w-0 truncate text-sm text-ink group-open/file-name:whitespace-normal group-open/file-name:break-all">
										{chip.file.name}
									</bdi>
								</summary>
							</details>
							<span
								className={cn(
									"text-xs",
									chip.status === "error" && state.enabled
										? "text-danger"
										: "text-ink-muted",
								)}
							>
								{/* Each chip says its OWN state (design D5 on #1720): `Attached`,
								    not the list's plural name, and a capability-off chip says
								    `Not uploaded` - nothing was attempted, so `Upload failed`
								    would be false; the note under the list says why. */}
								{t(
									chip.status === "error"
										? state.enabled
											? "ui.teamBridge.files.failed"
											: "ui.teamBridge.files.not_uploaded"
										: chip.status === "uploading"
											? "ui.teamBridge.files.uploading"
											: "ui.teamBridge.files.attached",
								)}
							</span>
						</div>
						{chip.status === "error" && state.enabled && (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.teamBridge.files.retry")}
								onClick={() => state.retry(chip.key)}
							>
								<RotateCw size={14} aria-hidden="true" />
							</Button>
						)}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.teamBridge.files.remove")}
							onClick={() => state.remove(chip.key)}
						>
							<X size={14} aria-hidden="true" />
						</Button>
					</li>
				))}
			</ul>
			{!state.enabled && (
				<output className="pt-1 text-xs text-ink-muted">
					{t("ui.teamBridge.files.unavailable")}
				</output>
			)}
		</div>
	);
}
