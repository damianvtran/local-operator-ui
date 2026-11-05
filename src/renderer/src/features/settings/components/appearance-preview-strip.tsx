import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ArrowUp, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { CSSProperties, FC } from "react";
import type { GlassPaint } from "../../../../../shared/window-glass";
import "./appearance-preview-strip.css";

/**
 * The composed appearance on representative components: a chat pair, the
 * composer, three sidebar rows, the three button kinds and the three callouts
 * (designer spec 4.1). It sits above the theme gallery so the user sees the
 * RESULT of theme x contrast x accent while scanning tiles, without leaving
 * Settings.
 *
 * WHAT IT PAINTS. By default it inherits the document's palette - the
 * composition `applyAppearance` published. Glass uses the same derived alphas
 * over an explicitly labelled abstract backdrop, not a native desktop capture.
 * `previewTheme` re-scopes it to another `[data-theme]` id: during a
 * contrast drag the picker writes an unverified candidate block (`previewCss`)
 * and points the strip at it, so the drag is visible at pointer speed while the
 * document root keeps the last VERIFIED composition. A scoped id works because
 * `themes.generated.css` re-declares every `--color-*` under
 * `[data-theme]:not(:root)` - the mechanism the theme tiles rely on.
 *
 * NOT INTERACTIVE. Every element is a picture of a control, so the strip is
 * `inert` (no tab stops, no pointer) and its content `aria-hidden`; the one label
 * on the strip itself tells a screen reader what it is. The hover row and the
 * disabled button are drawn in those states with the same role utilities the
 * real components use, not by forcing pseudo-classes.
 *
 * Intrinsic height lets translated samples wrap at narrow widths without a
 * clipped scrollport. Selection changes only colours, not sample structure.
 */
export const AppearancePreviewStrip: FC<{
	/** A scoped `[data-theme]` id to paint instead of the document's palette. */
	previewTheme?: string;
	className?: string;
	glassPaint?: GlassPaint | null;
}> = ({ previewTheme, className, glassPaint }) => {
	useI18nLocale();
	return (
		<section
			aria-label={t("ui.settings.appearance.layers.preview_label")}
			data-appearance-preview=""
			data-theme={previewTheme}
			data-preview-glass={glassPaint?.kinds ?? ""}
			style={glassPaint?.vars as CSSProperties}
			className={cn(
				"appearance-preview rounded-md border border-hairline",
				className,
			)}
		>
			<div
				data-preview-samples=""
				/* Set as an attribute, the way `quote-toolkit.tsx` does: React 18's
				   DOM types have no `inert` prop. */
				ref={setInert}
				aria-hidden="true"
				className={cn(
					"grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] items-start gap-2 rounded-md p-2 text-ink",
				)}
			>
				{/* 1. Chat pair */}
				<div
					data-preview-region="canvas"
					className="flex min-w-0 flex-col gap-2 rounded-md bg-canvas p-1"
				>
					<div
						data-preview-block=""
						className="self-end rounded-md bg-message-surface px-2.5 py-1.5 text-body-sm"
					>
						{t("ui.settings.appearance.layers.preview.user_message")}
					</div>
					<p className="text-body-sm text-ink-muted">
						{t("ui.settings.appearance.layers.preview.agent_reply")}{" "}
						<code className="rounded-xs bg-sunken px-1 font-mono text-meta text-token-command">
							{t("ui.settings.appearance.layers.preview.code")}
						</code>
					</p>
					{/* 2. Composer */}
					<div
						data-preview-field=""
						className="mt-auto flex items-center gap-2 rounded-md border border-control bg-sunken px-2 py-1.5"
					>
						<span className="min-w-0 flex-1 truncate text-body-sm text-ink-dim">
							{t("ui.settings.appearance.layers.preview.composer_placeholder")}
						</span>
						<span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-accent text-on-accent">
							<ArrowUp size={14} />
						</span>
					</div>
				</div>
				{/* 3. Sidebar rows: normal, hover (drawn), selected */}
				<div
					data-preview-region="sidebar"
					className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface p-1"
				>
					<div className="flex items-center rounded-sm px-2 py-1 text-body-sm text-ink-muted">
						<span className="truncate">
							{t("ui.settings.appearance.layers.preview.row_inbox")}
						</span>
					</div>
					<div className="flex items-center rounded-sm bg-row-hover px-2 py-1 text-body-sm text-ink">
						<span className="min-w-0 flex-1 truncate">
							{t("ui.settings.appearance.layers.preview.row_research")}
						</span>
						<AttentionBadge count={3} />
					</div>
					<div className="flex items-center rounded-sm bg-row-selected px-2 py-1 text-body-sm text-ink">
						<span className="truncate">
							{t("ui.settings.appearance.layers.preview.row_release")}
						</span>
					</div>
				</div>
				{/* 4. Buttons and 5. callouts */}
				<div
					data-preview-region="canvas"
					className="flex min-w-0 flex-col gap-1.5 rounded-md bg-canvas p-1"
				>
					<div className="flex flex-wrap gap-1.5">
						<span className="rounded-sm bg-accent px-2 py-0.5 text-meta text-on-accent">
							{t("ui.settings.appearance.layers.preview.primary")}
						</span>
						<span
							data-preview-field=""
							className="rounded-sm border border-control bg-surface px-2 py-0.5 text-meta text-ink"
						>
							{t("ui.settings.appearance.layers.preview.secondary")}
						</span>
						<span className="rounded-sm bg-sunken px-2 py-0.5 text-ink-disabled text-meta">
							{t("ui.settings.appearance.layers.preview.disabled")}
						</span>
					</div>
					<Callout tone="success" />
					<Callout tone="warning" />
					<Callout tone="danger" />
				</div>
			</div>
			<div className="bg-canvas px-2 py-1 text-ink-dim text-meta">
				{t("ui.settings.appearance.layers.preview.sample_backdrop")}
			</div>
		</section>
	);
};

const setInert = (node: HTMLDivElement | null): void => {
	node?.setAttribute("inert", "");
};

const CALLOUT = {
	success: {
		icon: CircleCheck,
		className: "border-success-border bg-success-wash text-success",
		key: "ui.settings.appearance.layers.preview.success",
	},
	warning: {
		icon: TriangleAlert,
		className: "border-warning-border bg-warning-wash text-warning",
		key: "ui.settings.appearance.layers.preview.warning",
	},
	danger: {
		icon: CircleAlert,
		className: "border-danger-border bg-danger-wash text-danger",
		key: "ui.settings.appearance.layers.preview.danger",
	},
} as const;

const Callout: FC<{ tone: keyof typeof CALLOUT }> = ({ tone }) => {
	const { icon: Icon, className, key } = CALLOUT[tone];
	return (
		<div
			className={cn(
				"flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-meta",
				className,
			)}
		>
			<Icon size={12} className="shrink-0" />
			<span className="truncate text-ink">{t(key)}</span>
		</div>
	);
};
