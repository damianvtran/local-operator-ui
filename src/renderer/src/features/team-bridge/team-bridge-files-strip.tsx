import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { FileIcon, RotateCw, X } from "lucide-react";
import type { TeamBridgeFilesState } from "./use-team-bridge-files";

/** Filename is authorized message content, not an identifier or accessible
 * control name. Fixed positional control labels keep bidi/hostile names out of
 * the controls; the visible name is isolated and never interpreted as markup. */
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
								className="shrink-0 text-ink-muted"
								aria-hidden="true"
							/>
						)}
						<div className="min-w-0 flex-1">
							<bdi className="block truncate text-sm text-ink">
								{chip.file.name}
							</bdi>
							<span className="text-xs text-ink-muted">
								{t(
									chip.status === "error"
										? "ui.teamBridge.files.failed"
										: chip.status === "uploading"
											? "ui.teamBridge.files.uploading"
											: "ui.teamBridge.files.staged",
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
