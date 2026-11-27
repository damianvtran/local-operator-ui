import { Button, Progress } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { installPhaseCopy } from "@shared/utils/update-install-copy";
import parse, {
	type DOMNode,
	Element,
	type HTMLReactParserOptions,
	domToReact,
} from "html-react-parser";
import { createElement, useId, useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import type {
	CombinedUpdateFailure,
	CombinedUpdateTargets,
} from "../../../../../shared/combined-update";

export type CombinedOffer = {
	targets: CombinedUpdateTargets;
	appNotes: string | null;
	serverNotes: string | null;
};
export type CombinedFailure = CombinedUpdateFailure | "request_failed";
export type CombinedProgress =
	| { phase: "download"; percent?: number }
	| { phase: "verifying" | "staging" | "starting" | "server" | "restarting" };

type TriggerOrigin = "notice" | "settings";
export const COMBINED_UPDATE_NOTICE = "combined-update-notice";
export const COMBINED_UPDATE_HEADING = "combined-update-heading";
export const combinedTriggerId = (origin: TriggerOrigin) =>
	`combined-update-trigger-${origin}`;

// Only the app-root update notification owns the offer and mounts the card.
// A Settings press selects its variant, not a second update surface. Snapshot
// the review so a feed refresh can't silently replace the confirmed versions.
export const useCombinedUpdateSurface = create<{
	offer: CombinedOffer | null;
	review: CombinedOffer | null;
	origin: TriggerOrigin | null;
	setOffer: (offer: CombinedOffer | null) => void;
	open: (origin: TriggerOrigin) => void;
	close: () => void;
}>((set) => ({
	offer: null,
	review: null,
	origin: null,
	setOffer: (offer) => set({ offer }),
	open: (origin) =>
		set((state) =>
			state.review || !state.offer ? state : { review: state.offer, origin },
		),
	close: () => set({ review: null, origin: null }),
}));

export function CombinedUpdateSummary({ className }: { className?: string }) {
	useI18nLocale();
	const targets = useCombinedUpdateSurface((state) => state.offer?.targets);
	if (!targets) return null;
	return (
		<div
			className={cn(
				"flex flex-wrap gap-x-3 gap-y-1 text-body-sm text-ink-muted",
				className,
			)}
		>
			<span dir="auto">
				{t("ui.common.updates.combined.app_version", { version: targets.app })}
			</span>
			<span dir="auto">
				{t("ui.common.updates.combined.server_version", {
					version: targets.server,
				})}
			</span>
		</div>
	);
}

export function CombinedUpdateTrigger({
	className,
	settings = false,
}: { className?: string; settings?: boolean }) {
	useI18nLocale();
	const shown = useCombinedUpdateSurface((state) =>
		Boolean(state.offer || state.review),
	);
	const reviewing = useCombinedUpdateSurface((state) => state.review !== null);
	const open = useCombinedUpdateSurface((state) => state.open);
	if (!shown) return null;
	return (
		<Button
			id={combinedTriggerId(settings ? "settings" : "notice")}
			variant={settings ? "primary" : "tonal"}
			size={settings ? undefined : "sm"}
			className={className}
			aria-expanded={reviewing}
			aria-controls={reviewing ? COMBINED_UPDATE_NOTICE : undefined}
			onClick={() => {
				if (reviewing) {
					const heading = document.getElementById(COMBINED_UPDATE_HEADING);
					heading?.scrollIntoView({ block: "nearest" });
					heading?.focus({ preventScroll: true });
				} else open(settings ? "settings" : "notice");
			}}
		>
			{t("ui.common.updates.combined.install_all")}
		</Button>
	);
}

const noteElements = new Set([
	"p",
	"ul",
	"ol",
	"li",
	"strong",
	"em",
	"b",
	"i",
	"code",
	"pre",
	"br",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
]);
const noteHeading = /^h[1-6]$/;
const noteOptions: HTMLReactParserOptions = {
	replace(node) {
		if (!(node instanceof Element)) return;
		// The feed is data, not app HTML. Keep formatting without event handlers,
		// images, arbitrary links, or other active elements/attributes. The only
		// links in this notice are to the two official repos, built below.
		if (node.name === "script" || node.name === "style") return <></>;
		const children = domToReact(node.children as DOMNode[], noteOptions);
		if (node.name === "br") return <br />;
		if (!noteElements.has(node.name)) return <>{children}</>;
		const name = noteHeading.test(node.name) ? "strong" : node.name;
		return createElement(name, null, children);
	},
};

function ReleaseSection({
	heading,
	notes,
	repo,
	version,
	html = false,
}: {
	heading: string;
	notes: string | null;
	repo: "local-operator-ui" | "local-operator";
	version: string;
	html?: boolean;
}) {
	const id = useId();
	return (
		<section className="min-w-0 space-y-1" aria-labelledby={`${id}-title`}>
			<h3
				id={`${id}-title`}
				dir="auto"
				className="text-body font-semibold text-ink"
			>
				{heading}
			</h3>
			{notes ? (
				<div
					dir="auto"
					className="whitespace-pre-wrap [overflow-wrap:anywhere] text-body text-ink-muted [&_li]:ms-5 [&_ol]:list-decimal [&_ul]:list-disc [&_pre]:whitespace-pre-wrap"
				>
					{html ? parse(notes, noteOptions) : notes}
				</div>
			) : (
				<p dir="auto" className="text-body text-ink-muted">
					{t("ui.common.updates.combined.notes_unavailable")}
				</p>
			)}
			<a
				id={`${id}-link`}
				aria-labelledby={`${id}-link ${id}-title`}
				className="text-body-sm"
				href={`https://github.com/damianvtran/${repo}/releases/tag/v${encodeURIComponent(version)}`}
				target="_blank"
				rel="noopener noreferrer"
			>
				{t("ui.common.updates.update_notification.view_full_release_notes")}
			</a>
		</section>
	);
}

const downloadLabelPunctuation = /[:：]$/;

function progressCopy(progress: CombinedProgress) {
	switch (progress.phase) {
		case "download":
			return t("ui.common.updates.update_notification.downloading")
				.trim()
				.replace(downloadLabelPunctuation, "");
		case "server":
			return t("ui.common.updates.update_notification.updating_server");
		case "restarting":
			return t("ui.common.updates.combined.restarting_server");
		default:
			return installPhaseCopy(progress.phase);
	}
}

export function CombinedUpdateContent({
	review,
	progress,
	failure,
	onDismiss,
	onConfirm,
}: {
	review: CombinedOffer;
	progress: CombinedProgress | null;
	failure: CombinedFailure | null;
	onDismiss: () => void;
	onConfirm: () => void;
}) {
	useI18nLocale();
	const contentRef = useRef<HTMLDivElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const dismissRef = useRef<HTMLButtonElement>(null);
	const lastFocusWasHere = useRef(true);
	const pending = progress !== null;
	const percent =
		progress?.phase === "download" ? (progress.percent ?? null) : null;
	useLayoutEffect(() => {
		// Both entry points land on the safe action. Pending focuses its heading,
		// not a disabled button. On a later result, never steal focus from a user
		// who has continued working outside this non-modal notice.
		const target = pending ? headingRef.current : dismissRef.current;
		if (lastFocusWasHere.current) target?.focus();
	}, [pending]);
	return (
		<div
			ref={contentRef}
			className="space-y-3"
			onFocus={() => {
				lastFocusWasHere.current = true;
			}}
			onBlur={(event) => {
				// An action unmounted by a phase change can drop focus to body. That is
				// not the same as the person moving on to another control.
				if (
					event.relatedTarget &&
					!contentRef.current?.contains(event.relatedTarget)
				)
					lastFocusWasHere.current = false;
			}}
		>
			<h2
				ref={headingRef}
				id={COMBINED_UPDATE_HEADING}
				tabIndex={-1}
				className="text-heading text-ink"
			>
				{t(
					pending
						? "ui.common.updates.combined.in_progress"
						: "ui.common.updates.combined.install_all",
				)}
			</h2>
			{failure && (
				<p role="alert" className="text-body font-medium text-ink">
					{t(`ui.common.updates.combined.${failure}`)}
				</p>
			)}
			{pending ? (
				<>
					<div className="flex flex-wrap gap-x-3 text-body-sm text-ink-muted">
						<span dir="auto">
							{t("ui.common.updates.combined.app_version", {
								version: review.targets.app,
							})}
						</span>
						<span dir="auto">
							{t("ui.common.updates.combined.server_version", {
								version: review.targets.server,
							})}
						</span>
					</div>
					<output
						aria-live="polite"
						aria-atomic="true"
						className="block text-body text-ink"
					>
						{progressCopy(progress)}
					</output>
					<Progress
						value={percent}
						indicatorClassName={
							percent === null ? "w-1/3 motion-reduce:animate-none" : undefined
						}
						aria-label={progressCopy(progress)}
					/>
				</>
			) : (
				<>
					{!failure && (
						<p className="text-body text-ink-muted">
							{t("ui.common.updates.combined.description")}
						</p>
					)}
					<ReleaseSection
						heading={t("ui.common.updates.combined.app_version", {
							version: review.targets.app,
						})}
						notes={review.appNotes}
						repo="local-operator-ui"
						version={review.targets.app}
						html
					/>
					<ReleaseSection
						heading={t("ui.common.updates.combined.server_version", {
							version: review.targets.server,
						})}
						notes={review.serverNotes}
						repo="local-operator"
						version={review.targets.server}
					/>
				</>
			)}
			<p className="text-body-sm text-ink-muted">
				{t("ui.common.updates.update_foot_icon.sessions_keep_running")}
			</p>

			{!pending && (
				<div className="flex flex-wrap justify-end gap-2">
					<Button
						ref={dismissRef}
						variant="tonal"
						size="sm"
						onClick={onDismiss}
					>
						{t(
							failure ? "ui.common.actions.close" : "ui.common.actions.cancel",
						)}
					</Button>
					{!failure && (
						<Button variant="primary" size="sm" onClick={onConfirm}>
							{t("ui.common.updates.combined.install_both")}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
