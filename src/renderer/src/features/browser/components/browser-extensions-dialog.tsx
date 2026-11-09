import { BaseDialog } from "@shared/components/common/base-dialog";
import { Badge, Button, Switch } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import type {
	ExtensionStatus,
	ExtensionSummary,
} from "../../../../../shared/browser-extensions";
import { ExtensionIcon } from "./browser-extensions-menu";

export interface BrowserExtensionsDialogProps {
	open: boolean;
	extensions: ExtensionSummary[];
	/** Ids with an op in flight (and "updates" while checking). */
	busy: ReadonlySet<string>;
	checking: boolean;
	onClose: () => void;
	onSetEnabled: (extension: ExtensionSummary, enabled: boolean) => void;
	onRemove: (extension: ExtensionSummary) => void;
	onOpen: (extension: ExtensionSummary, page: "popup" | "options") => void;
	onOpenStore: () => void;
	onCheckUpdates: () => void;
}

const STATUS_LABEL: Record<ExtensionStatus, () => string> = {
	enabled: () => t("ui.browser.extensions.status_enabled"),
	disabled: () => t("ui.browser.extensions.status_disabled"),
	loading: () => t("ui.browser.extensions.status_loading"),
	error: () => t("ui.browser.extensions.status_error"),
	"needs-reconsent": () => t("ui.browser.extensions.status_needs_reconsent"),
};

function errorText(extension: ExtensionSummary): string | null {
	if (extension.status !== "error") return null;
	switch (extension.error) {
		case "verify":
			return t("ui.browser.extensions.error_verify");
		case "download":
			return t("ui.browser.extensions.error_download");
		case "worker":
			return t("ui.browser.extensions.error_worker");
		default:
			return t("ui.browser.extensions.error_startup");
	}
}

function accessLines(extension: ExtensionSummary): string[] {
	const lines: string[] = [];
	if (extension.allSites) lines.push(t("ui.browser.extensions.perm_all_sites"));
	else if (extension.hosts.length)
		lines.push(
			t("ui.browser.extensions.perm_sites", {
				hosts: extension.hosts.join(", "),
			}),
		);
	if (extension.permissions.length)
		lines.push(
			t("ui.browser.extensions.perm_other", {
				permissions: extension.permissions.join(", "),
			}),
		);
	return lines.length ? lines : [t("ui.browser.extensions.perm_none")];
}

/**
 * Manage extensions (design §4.3): a desktop dialog, not an internal
 * chrome:// page (the browser has no internal-page scheme, and adding one is a
 * new navigation surface agents could reach).
 *
 * Every control is a REQUEST to main. Turning on, approving an update and
 * removing are confirmed by main's native dialog, which the renderer cannot
 * pre-answer; this dialog never shows its own "are you sure". Status is
 * reported honestly: a loaded extension whose worker never started reads
 * "Not working", not "On" — the UI never claims an extension works.
 */
export const BrowserExtensionsDialog: FC<BrowserExtensionsDialogProps> = ({
	open,
	extensions,
	busy,
	checking,
	onClose,
	onSetEnabled,
	onRemove,
	onOpen,
	onOpenStore,
	onCheckUpdates,
}) => {
	useI18nLocale();
	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={t("ui.browser.extensions.manage_title")}
			maxWidth="xs"
			dataTourTag="browser-extensions-dialog"
			actions={
				<>
					<Button
						variant="ghost"
						size="sm"
						disabled={checking || extensions.length === 0}
						onClick={onCheckUpdates}
					>
						{checking
							? t("ui.browser.extensions.manage_checking")
							: t("ui.browser.extensions.manage_check_updates")}
					</Button>
					<Button variant="ghost" size="sm" onClick={onOpenStore}>
						{t("ui.browser.extensions.manage_open_store")}
					</Button>
					<Button variant="primary" size="sm" onClick={onClose}>
						{t("ui.browser.extensions.manage_close")}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-body text-ink-muted">
					{t("ui.browser.extensions.manage_description")}
				</p>
				{extensions.length === 0 ? (
					<p
						className="text-body text-ink-dim"
						data-tour-tag="browser-extensions-empty"
					>
						{t("ui.browser.extensions.manage_empty")}
					</p>
				) : (
					<ul className="flex flex-col divide-y divide-hairline">
						{extensions.map((extension) => {
							const working =
								busy.has(extension.id) || extension.status === "loading";
							const on = extension.status !== "disabled";
							const problem = errorText(extension);
							return (
								<li
									key={extension.id}
									className="flex flex-col gap-1.5 py-2.5"
									data-extension-id={extension.id}
								>
									<div className="flex items-center gap-2">
										<ExtensionIcon extension={extension} size="size-6" />
										<div className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-body text-ink">
												{extension.name}
											</span>
											<span className="text-mono-sm text-ink-dim">
												{t("ui.browser.extensions.version", {
													version: extension.version,
												})}
											</span>
										</div>
										<Badge
											variant={
												extension.status === "error"
													? "danger"
													: extension.status === "enabled"
														? "success"
														: "neutral"
											}
										>
											{STATUS_LABEL[extension.status]()}
										</Badge>
										<Switch
											checked={on}
											disabled={working}
											aria-label={t("ui.browser.extensions.toggle_label", {
												name: extension.name,
											})}
											onCheckedChange={(checked) =>
												onSetEnabled(extension, checked)
											}
										/>
									</div>
									{problem && (
										<p className="text-body-sm text-danger">{problem}</p>
									)}
									{extension.pendingVersion && (
										<p className="text-body-sm text-ink-muted">
											{t("ui.browser.extensions.reconsent_note", {
												version: extension.pendingVersion,
											})}
										</p>
									)}
									<details className="text-body-sm text-ink-muted">
										<summary className="cursor-pointer">
											{t("ui.browser.extensions.permissions_heading")}
										</summary>
										<ul className="mt-1 list-disc ps-5">
											{accessLines(extension).map((line) => (
												<li key={line} className="break-words">
													{line}
												</li>
											))}
										</ul>
									</details>
									<div className="flex flex-wrap gap-1.5">
										{extension.hasPopup && (
											<Button
												variant="ghost"
												size="sm"
												disabled={working}
												onClick={() => onOpen(extension, "popup")}
											>
												{t("ui.browser.extensions.action_open")}
											</Button>
										)}
										{extension.hasOptions && (
											<Button
												variant="ghost"
												size="sm"
												disabled={working}
												onClick={() => onOpen(extension, "options")}
											>
												{t("ui.browser.extensions.action_options")}
											</Button>
										)}
										{extension.pendingVersion && (
											<Button
												variant="ghost"
												size="sm"
												disabled={working}
												onClick={() => onSetEnabled(extension, true)}
											>
												{t("ui.browser.extensions.action_review_update")}
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											disabled={working}
											onClick={() => onRemove(extension)}
										>
											{t("ui.browser.extensions.action_remove")}
										</Button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</BaseDialog>
	);
};
