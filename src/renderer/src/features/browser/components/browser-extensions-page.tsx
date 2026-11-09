import { Badge, Button, Input, Skeleton, Switch } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ArrowLeft, Download, Search, Store } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type ExtensionInstallProgress,
	type ExtensionSummary,
	describePermissions,
} from "../../../../../shared/browser-extensions";
import {
	EXTENSIONS_PAGE_URL,
	type InternalPage,
	internalUrlOf,
} from "../../../../../shared/internal-pages";
import {
	type ExtensionsLoadState,
	useBrowserExtensions,
} from "../hooks/use-browser-extensions";
import { ExtensionIcon } from "./browser-extensions-menu";

/**
 * lop://extensions — the embedded browser's extension manager as a full page
 * (operator request: "similar to the chrome extensions page … opens in that tab
 * and fills the screen"). Replaces the earlier manage dialog.
 *
 * WHERE IT RUNS. This is desktop-renderer DOM painted in the active tab's
 * content rect while main hides that tab's WebContentsView
 * (browser-surface.tsx; main's half is src/main/browser/internal-pages.ts). It
 * therefore uses the same sender-checked `browser-extensions` IPC the dialog
 * used, and no web page, extension or agent CDP session can load, frame or
 * script it. Back/Forward work because main gives the page a real history
 * entry.
 *
 * Every control is a REQUEST to main. Turning on, approving an update and
 * removing are confirmed by main's native dialog, which this page cannot
 * pre-answer. Status is reported honestly: a loaded extension whose worker has
 * not started reads "Not ready" with Try again, never "On".
 *
 * Layout: design review round 1 spec (PR #1821) — centred 720px column,
 * sticky header, search with initial focus (D5/U3: never a toggle, so one stray
 * key cannot turn a password manager off), 2-column card grid at >=640px
 * content width, details at lop://extensions?id=<id>.
 */

export interface ExtensionsPageViewProps {
	page: InternalPage;
	loadState: ExtensionsLoadState;
	extensions: ExtensionSummary[];
	installing: ExtensionInstallProgress[];
	busy: ReadonlySet<string>;
	checking: boolean;
	updateMessage: string | null;
	onNavigate: (url: string) => void;
	onReload: () => void;
	onSetEnabled: (extension: ExtensionSummary, enabled: boolean) => void;
	/** Resolves true when the extension was removed. */
	onRemove: (extension: ExtensionSummary) => Promise<boolean>;
	onOpen: (extension: ExtensionSummary, page: "popup" | "options") => void;
	onOpenLink: (
		extension: ExtensionSummary,
		link: "listing" | "homepage",
	) => void;
	onRetry: (extension: ExtensionSummary) => void;
	onCancelInstall: (id: string) => void;
	onOpenStore: () => void;
	onCheckUpdates: () => void;
}

/** Badge for NON-binary states only (design D4): the switch already says
 * on/off, so "On"/"Off" badges would repeat it. */
function stateBadge(
	extension: ExtensionSummary,
): { label: string; variant: "danger" | "neutral" | "warning" } | null {
	if (extension.status === "loading")
		return {
			label: t("ui.browser.extensions.status_loading"),
			variant: "neutral",
		};
	if (extension.status === "error")
		return extension.error === "worker"
			? {
					label: t("ui.browser.extensions.status_not_ready"),
					variant: "warning",
				}
			: { label: t("ui.browser.extensions.status_error"), variant: "danger" };
	if (extension.status === "needs-reconsent")
		return {
			label: t("ui.browser.extensions.status_needs_reconsent"),
			variant: "neutral",
		};
	return null;
}

function problemText(extension: ExtensionSummary): string | null {
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

/** Remembers which card's Details was pressed, so returning to the list puts
 * focus back on it (design spec §4). Module scope: the list remounts. */
let lastDetailsId: string | null = null;

export const ExtensionsPageView: FC<ExtensionsPageViewProps> = (props) => {
	useI18nLocale();
	const scroller = useRef<HTMLDivElement | null>(null);
	const [scrolled, setScrolled] = useState(false);
	const detail = props.page.id
		? (props.extensions.find((item) => item.id === props.page.id) ?? null)
		: null;
	return (
		<div
			ref={scroller}
			onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
			className="h-full overflow-y-auto bg-canvas"
			data-tour-tag="browser-extensions-page"
			data-internal-url={internalUrlOf(props.page)}
		>
			{props.page.id ? (
				<DetailsView {...props} extension={detail} scrolled={scrolled} />
			) : (
				<ListView {...props} scrolled={scrolled} />
			)}
		</div>
	);
};

/** Centred column. `px-6` keeps every focus ring (2px + 2px offset) clear of
 * the scroll container's clip edge (design D1). */
const Column: FC<{ children: ReactNode; className?: string }> = ({
	children,
	className,
}) => (
	<div className={cn("mx-auto w-full max-w-[720px] px-6", className)}>
		{children}
	</div>
);

const ListView: FC<ExtensionsPageViewProps & { scrolled: boolean }> = ({
	loadState,
	extensions,
	installing,
	busy,
	checking,
	updateMessage,
	onNavigate,
	onReload,
	onSetEnabled,
	onRemove,
	onOpen,
	onRetry,
	onCancelInstall,
	onOpenStore,
	onCheckUpdates,
	scrolled,
}) => {
	const [query, setQuery] = useState("");
	const search = useRef<HTMLInputElement | null>(null);
	const grid = useRef<HTMLUListElement | null>(null);
	// Initial focus: search (D5/U3), or the Details button of the card the user
	// came back from.
	useEffect(() => {
		if (loadState !== "ready") return;
		const back = lastDetailsId
			? grid.current?.querySelector<HTMLButtonElement>(
					`[data-details-for="${lastDetailsId}"]`,
				)
			: null;
		lastDetailsId = null;
		(back ?? search.current)?.focus();
	}, [loadState]);
	const needle = query.trim().toLocaleLowerCase();
	const shown = useMemo(
		() =>
			needle
				? extensions.filter((item) =>
						item.name.toLocaleLowerCase().includes(needle),
					)
				: extensions,
		[extensions, needle],
	);
	return (
		<>
			<header
				className={cn(
					"sticky top-0 z-10 bg-canvas pt-6 pb-4",
					scrolled && "border-hairline border-b",
				)}
			>
				<Column className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
						<h1 className="text-display text-ink">
							{t("ui.browser.extensions.manage_title")}
						</h1>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								disabled={checking || extensions.length === 0}
								onClick={onCheckUpdates}
								data-tour-tag="browser-extensions-check-updates"
							>
								{checking
									? t("ui.browser.extensions.manage_checking")
									: t("ui.browser.extensions.manage_check_updates")}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={onOpenStore}
								data-tour-tag="browser-extensions-open-store"
							>
								<Store aria-hidden />
								{t("ui.browser.extensions.manage_open_store")}
							</Button>
						</div>
					</div>
					<p className="text-body text-ink-muted">
						{t("ui.browser.extensions.manage_description")}
					</p>
					<div className="relative">
						<Search
							aria-hidden
							className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-dim"
						/>
						<Input
							ref={search}
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("ui.browser.extensions.search_placeholder")}
							aria-label={t("ui.browser.extensions.search_placeholder")}
							className="ps-8"
							data-tour-tag="browser-extensions-search"
						/>
					</div>
					<output aria-live="polite" className="text-body-sm text-ink-muted">
						{updateMessage ?? ""}
					</output>
				</Column>
			</header>
			<Column className="flex flex-col gap-4 pb-8">
				{installing.map((install) => (
					<InstallRow
						key={install.id}
						install={install}
						busy={busy.has(`install:${install.id}`)}
						onCancel={onCancelInstall}
					/>
				))}
				{loadState === "loading" ? (
					<ul
						className="grid grid-cols-1 gap-3 @[640px]:grid-cols-2"
						aria-busy="true"
						aria-label={t("ui.browser.extensions.loading_label")}
					>
						{[0, 1].map((index) => (
							<li
								key={index}
								className="flex h-[156px] flex-col gap-3 rounded-md bg-surface p-4"
							>
								<div className="flex items-center gap-3">
									<Skeleton className="size-10" />
									<Skeleton className="h-4 flex-1" />
								</div>
								<Skeleton className="h-3 w-full" />
								<Skeleton className="h-3 w-2/3" />
							</li>
						))}
					</ul>
				) : loadState === "error" ? (
					<div className="flex flex-col items-center gap-3 py-12 text-center">
						<p className="text-body text-ink-muted">
							{t("ui.browser.extensions.load_error")}
						</p>
						<Button variant="outline" size="sm" onClick={onReload}>
							{t("ui.browser.extensions.action_retry")}
						</Button>
					</div>
				) : extensions.length === 0 ? (
					<div
						className="flex flex-col items-center gap-3 py-12 text-center"
						data-tour-tag="browser-extensions-empty"
					>
						<p className="text-body text-ink-muted">
							{t("ui.browser.extensions.manage_empty")}
						</p>
						<Button variant="primary" size="sm" onClick={onOpenStore}>
							<Store aria-hidden />
							{t("ui.browser.extensions.manage_open_store")}
						</Button>
					</div>
				) : shown.length === 0 ? (
					<p className="py-12 text-center text-body text-ink-muted">
						{t("ui.browser.extensions.search_none", { query: query.trim() })}
					</p>
				) : (
					<div className="@container">
						<ul
							ref={grid}
							className="grid grid-cols-1 gap-3 @[640px]:grid-cols-2"
						>
							{shown.map((extension) => (
								<ExtensionCard
									key={extension.id}
									extension={extension}
									working={busy.has(extension.id)}
									onDetails={() => {
										lastDetailsId = extension.id;
										onNavigate(
											internalUrlOf({ page: "extensions", id: extension.id }),
										);
									}}
									onSetEnabled={onSetEnabled}
									onRemove={onRemove}
									onOpen={onOpen}
									onRetry={onRetry}
								/>
							))}
						</ul>
					</div>
				)}
			</Column>
		</>
	);
};

const InstallRow: FC<{
	install: ExtensionInstallProgress;
	busy: boolean;
	onCancel: (id: string) => void;
}> = ({ install, busy, onCancel }) => (
	<div
		className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-4 py-3"
		data-tour-tag="browser-extensions-installing"
	>
		<Download aria-hidden className="size-4 shrink-0 text-ink-muted" />
		<output aria-live="polite" className="min-w-0 flex-1 text-body-sm text-ink">
			{install.phase === "downloading"
				? t("ui.browser.extensions.install_downloading")
				: t("ui.browser.extensions.install_verifying")}
		</output>
		<Button
			variant="ghost"
			size="sm"
			disabled={busy}
			onClick={() => onCancel(install.id)}
		>
			{t("ui.browser.extensions.install_confirm_cancel")}
		</Button>
	</div>
);

/** Progress strip for an install started from the store page (U5): the user
 * is on the store tab, not on lop://extensions, so the browser surface shows
 * this above the page while a download/verify runs. */
export const BrowserExtensionInstallStrip: FC = () => {
	useI18nLocale();
	const { installing, busy, cancelInstall } = useBrowserExtensions();
	if (!installing.length) return null;
	return (
		<div className="flex flex-col gap-1 border-control border-b bg-surface px-3 py-1.5">
			{installing.map((install) => (
				<div key={install.id} className="flex items-center gap-3">
					<Download aria-hidden className="size-4 shrink-0 text-ink-muted" />
					<output
						aria-live="polite"
						className="min-w-0 flex-1 text-body-sm text-ink"
					>
						{install.phase === "downloading"
							? t("ui.browser.extensions.install_downloading")
							: t("ui.browser.extensions.install_verifying")}
					</output>
					<Button
						variant="ghost"
						size="sm"
						disabled={busy.has(`install:${install.id}`)}
						onClick={() => cancelInstall(install.id)}
					>
						{t("ui.browser.extensions.install_confirm_cancel")}
					</Button>
				</div>
			))}
		</div>
	);
};

const ExtensionCard: FC<{
	extension: ExtensionSummary;
	working: boolean;
	onDetails: () => void;
	onSetEnabled: ExtensionsPageViewProps["onSetEnabled"];
	onRemove: ExtensionsPageViewProps["onRemove"];
	onOpen: ExtensionsPageViewProps["onOpen"];
	onRetry: ExtensionsPageViewProps["onRetry"];
}> = ({
	extension,
	working,
	onDetails,
	onSetEnabled,
	onRemove,
	onOpen,
	onRetry,
}) => {
	const busy = working || extension.status === "loading";
	const badge = stateBadge(extension);
	const problem = problemText(extension);
	return (
		<li
			className="flex min-w-0 flex-col gap-2 rounded-md bg-surface p-4"
			data-extension-id={extension.id}
		>
			<div className="flex min-w-0 items-start gap-3">
				<ExtensionIcon extension={extension} size="size-10" />
				<div className="flex min-w-0 flex-1 flex-col">
					<span
						className="truncate text-heading text-ink"
						title={extension.name}
					>
						{extension.name}
					</span>
					{/* The state badge shares the version line rather than the title
					    row: at 2-column card width a badge beside the name squeezed
					    "Example Blocker" to one letter (round-2 frames). */}
					<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-mono-sm text-ink-dim">
							{extension.version}
						</span>
						{badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
					</span>
				</div>
				<Switch
					className="shrink-0"
					checked={extension.status !== "disabled"}
					disabled={busy}
					aria-label={t("ui.browser.extensions.toggle_label", {
						name: extension.name,
					})}
					onCheckedChange={(checked) => onSetEnabled(extension, checked)}
				/>
			</div>
			{extension.description && (
				<p className="line-clamp-2 text-body-sm text-ink-muted">
					{extension.description}
				</p>
			)}
			{problem && <p className="text-body-sm text-danger">{problem}</p>}
			{extension.pendingVersion && (
				<p className="text-body-sm text-ink-muted">
					{t("ui.browser.extensions.reconsent_note", {
						version: extension.pendingVersion,
					})}
				</p>
			)}
			{extension.waitingPages > 0 && (
				<p className="text-body-sm text-ink-muted">
					{t("ui.browser.extensions.waiting_pages", {
						count: extension.waitingPages,
					})}
				</p>
			)}
			<div className="mt-auto flex flex-wrap gap-1.5 pt-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={onDetails}
					data-details-for={extension.id}
				>
					{t("ui.browser.extensions.action_details")}
				</Button>
				{extension.status === "error" && extension.error === "worker" && (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => onRetry(extension)}
					>
						{t("ui.browser.extensions.action_retry")}
					</Button>
				)}
				{extension.pendingVersion && (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => onSetEnabled(extension, true)}
					>
						{t("ui.browser.extensions.action_review_update")}
					</Button>
				)}
				{(extension.hasOptions || extension.waitingPages > 0) && (
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() =>
							onOpen(extension, extension.hasOptions ? "options" : "popup")
						}
					>
						{extension.hasOptions
							? t("ui.browser.extensions.action_options")
							: t("ui.browser.extensions.action_open")}
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() => void onRemove(extension)}
				>
					{t("ui.browser.extensions.action_remove")}
				</Button>
			</div>
		</li>
	);
};

/** One details section: heading + hairline rule, Chrome's row rhythm. */
const Section: FC<{ title: string; children: ReactNode }> = ({
	title,
	children,
}) => (
	<section className="flex flex-col gap-2 border-hairline border-t py-4">
		<h2 className="text-heading text-ink">{title}</h2>
		{children}
	</section>
);

const DetailsView: FC<
	ExtensionsPageViewProps & {
		extension: ExtensionSummary | null;
		scrolled: boolean;
	}
> = ({
	extension,
	loadState,
	busy,
	onNavigate,
	onSetEnabled,
	onRemove,
	onOpen,
	onOpenLink,
	onRetry,
	scrolled,
}) => {
	const back = useRef<HTMLButtonElement | null>(null);
	// Initial focus on Back, never on the switch (U3/D5).
	useEffect(() => {
		back.current?.focus();
	}, []);
	const header = (
		<header
			className={cn(
				"sticky top-0 z-10 bg-canvas pt-6 pb-3",
				scrolled && "border-hairline border-b",
			)}
		>
			<Column>
				<Button
					ref={back}
					variant="ghost"
					size="sm"
					onClick={() => onNavigate(EXTENSIONS_PAGE_URL)}
					data-tour-tag="browser-extensions-back"
				>
					<ArrowLeft aria-hidden className="rtl:-scale-x-100" />
					{t("ui.browser.extensions.action_back")}
				</Button>
			</Column>
		</header>
	);
	if (!extension)
		return (
			<>
				{header}
				<Column className="py-12 text-center">
					<p className="text-body text-ink-muted">
						{loadState === "loading"
							? t("ui.browser.extensions.loading_label")
							: t("ui.browser.extensions.details_not_found")}
					</p>
				</Column>
			</>
		);
	const working = busy.has(extension.id) || extension.status === "loading";
	const badge = stateBadge(extension);
	const problem = problemText(extension);
	const permissions = describePermissions(extension.permissions);
	return (
		<>
			{header}
			<Column className="flex flex-col pb-10">
				<div className="flex min-w-0 items-center gap-3 pb-4">
					<ExtensionIcon extension={extension} size="size-10" />
					<h1 className="min-w-0 flex-1 truncate text-display text-ink">
						{extension.name}
					</h1>
					{badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
				</div>
				<Section title={t("ui.browser.extensions.details_on_off")}>
					<div className="flex items-center justify-between gap-3">
						<span className="text-body text-ink">
							{extension.status === "disabled"
								? t("ui.browser.extensions.status_disabled")
								: t("ui.browser.extensions.status_enabled")}
						</span>
						<Switch
							checked={extension.status !== "disabled"}
							disabled={working}
							aria-label={t("ui.browser.extensions.toggle_label", {
								name: extension.name,
							})}
							onCheckedChange={(checked) => onSetEnabled(extension, checked)}
						/>
					</div>
					{problem && <p className="text-body-sm text-danger">{problem}</p>}
					{extension.status === "error" && extension.error === "worker" && (
						<div>
							<Button
								variant="outline"
								size="sm"
								disabled={working}
								onClick={() => onRetry(extension)}
							>
								{t("ui.browser.extensions.action_retry")}
							</Button>
						</div>
					)}
				</Section>
				{extension.description && (
					<Section title={t("ui.browser.extensions.details_description")}>
						<p className="text-body text-ink-muted">{extension.description}</p>
					</Section>
				)}
				<Section title={t("ui.browser.extensions.details_version")}>
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
						<dt className="text-body-sm text-ink-muted">
							{t("ui.browser.extensions.details_version")}
						</dt>
						<dd className="text-mono-sm text-ink select-text">
							{extension.version}
						</dd>
						<dt className="text-body-sm text-ink-muted">
							{t("ui.browser.extensions.details_id")}
						</dt>
						<dd className="break-all text-mono-sm text-ink select-text">
							{extension.id}
						</dd>
					</dl>
				</Section>
				<Section title={t("ui.browser.extensions.details_site_access")}>
					<p className="text-body text-ink">
						{extension.allSites
							? t("ui.browser.extensions.perm_all_sites")
							: extension.hosts.length
								? t("ui.browser.extensions.perm_sites", {
										hosts: extension.hosts.join(", "),
									})
								: t("ui.browser.extensions.site_access_none")}
					</p>
				</Section>
				<Section title={t("ui.browser.extensions.details_permissions")}>
					{permissions.labels.length || permissions.other.length ? (
						<ul className="list-disc ps-5 text-body text-ink">
							{permissions.labels.map((key) => (
								<li key={key}>{t(key)}</li>
							))}
							{permissions.other.length > 0 && (
								<li className="text-mono-sm text-ink-muted break-words">
									{t("ui.browser.extensions.perm_other", {
										permissions: permissions.other.join(", "),
									})}
								</li>
							)}
						</ul>
					) : (
						<p className="text-body text-ink-muted">
							{t("ui.browser.extensions.permissions_none")}
						</p>
					)}
				</Section>
				{permissions.blocked.length > 0 && (
					<Section title={t("ui.browser.extensions.blocked_heading")}>
						<ul className="list-disc ps-5 text-body text-ink-muted">
							{permissions.blocked.map((capability) => (
								<li key={capability}>
									{capability === "desktop_apps"
										? t("ui.browser.extensions.blocked_desktop_apps")
										: t("ui.browser.extensions.blocked_notifications")}
								</li>
							))}
						</ul>
					</Section>
				)}
				<Section title={t("ui.browser.extensions.details_options")}>
					{extension.hasOptions ? (
						<div>
							<Button
								variant="outline"
								size="sm"
								disabled={working}
								onClick={() => onOpen(extension, "options")}
							>
								{t("ui.browser.extensions.action_options")}
							</Button>
						</div>
					) : (
						<p className="text-body text-ink-muted">
							{extension.hasPopup
								? t("ui.browser.extensions.details_no_options")
								: t("ui.browser.extensions.details_no_ui")}
						</p>
					)}
					{(extension.hasPopup || extension.waitingPages > 0) && (
						<div>
							<Button
								variant="outline"
								size="sm"
								disabled={working}
								onClick={() => onOpen(extension, "popup")}
							>
								{t("ui.browser.extensions.action_open")}
							</Button>
						</div>
					)}
					{extension.waitingPages > 0 && (
						<p className="text-body-sm text-ink-muted">
							{t("ui.browser.extensions.waiting_pages", {
								count: extension.waitingPages,
							})}
						</p>
					)}
				</Section>
				{extension.pendingVersion && (
					<Section title={t("ui.browser.extensions.details_updates")}>
						<p className="text-body text-ink-muted">
							{t("ui.browser.extensions.reconsent_note", {
								version: extension.pendingVersion,
							})}
						</p>
						<div>
							<Button
								variant="outline"
								size="sm"
								disabled={working}
								onClick={() => onSetEnabled(extension, true)}
							>
								{t("ui.browser.extensions.action_review_update")}
							</Button>
						</div>
					</Section>
				)}
				<Section title={t("ui.browser.extensions.details_source")}>
					<p className="text-body text-ink">
						{t("ui.browser.extensions.source_store")}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onOpenLink(extension, "listing")}
						>
							{t("ui.browser.extensions.action_view_in_store")}
						</Button>
						{extension.hasHomepage && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onOpenLink(extension, "homepage")}
							>
								{t("ui.browser.extensions.action_open_website")}
							</Button>
						)}
					</div>
				</Section>
				<div className="border-hairline border-t pt-4">
					<Button
						variant="danger"
						size="sm"
						disabled={working}
						onClick={() =>
							void onRemove(extension).then((removed) => {
								if (removed) onNavigate(EXTENSIONS_PAGE_URL);
							})
						}
					>
						{t("ui.browser.extensions.action_remove_extension")}
					</Button>
				</div>
			</Column>
		</>
	);
};

/** The live page: main's list through the shared hook. */
export const BrowserExtensionsPage: FC<{
	page: InternalPage;
	onNavigate: (url: string) => void;
}> = ({ page, onNavigate }) => {
	const state = useBrowserExtensions();
	return (
		<ExtensionsPageView
			page={page}
			loadState={state.loadState}
			extensions={state.extensions}
			installing={state.installing}
			busy={state.busy}
			checking={state.checking}
			updateMessage={state.updateMessage}
			onNavigate={onNavigate}
			onReload={state.refresh}
			onSetEnabled={(extension, enabled) =>
				void state.setEnabled(extension, enabled)
			}
			onRemove={state.remove}
			onOpen={(extension, kind) => void state.open(extension, kind)}
			onOpenLink={(extension, link) => void state.openLink(extension, link)}
			onRetry={state.retry}
			onCancelInstall={state.cancelInstall}
			onOpenStore={state.openStore}
			onCheckUpdates={() => void state.checkUpdates()}
		/>
	);
};
