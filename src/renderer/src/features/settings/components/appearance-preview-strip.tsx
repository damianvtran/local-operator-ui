import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useResolvedAppearance } from "@shared/themes/use-resolved-appearance";
import { ArrowUp, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { CSSProperties, FC } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { WindowGlassState } from "../../../../../shared/window-glass";
import {
	type PreviewGlass,
	previewBackdropVars,
	previewGlassState,
	readPreviewPalette,
} from "./appearance-preview-glass";
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
 * over a NEUTRAL backdrop fixed to the measured material tone, never the user's
 * own accent: the ground must not move with the palette being judged, and the
 * production floors are solved against that grey (`previewBackdropVars`).
 * `previewTheme` re-scopes it to another `[data-theme]` id: during a
 * contrast drag the picker writes an unverified candidate block (`previewCss`)
 * and points the strip at it, so the drag is visible at pointer speed while the
 * document root keeps the last VERIFIED composition. A scoped id works because
 * `themes.generated.css` re-declares every `--color-*` under
 * `[data-theme]:not(:root)` - the mechanism the theme tiles rely on.
 *
 * IT IS A PREVIEW, AND SAYS SO. The header line is the sample's accessible name
 * made visible, and the caption below it is painted ONLY while the sample
 * actually shows a backdrop (design D1: round 1 labelled a backdrop in the
 * solid states, where none is painted; UX U3: nothing said what the block was).
 * UX U2's short per-state reason is DEFERRED rather than smuggled in: new public
 * copy needs an independently audited receipt per locale from the i18n gate, and
 * this lane cannot issue its own audit.
 *
 * TWO SIZES, ONE PICTURE. `compact` drops the buttons/callouts column and keeps
 * the chat pair and sidebar rows, so a live sample can sit beside the Contrast
 * and Accent controls the sample exists to explain (UX U1). Both variants read
 * the same palette, floor table and state - the compact one is a layout, not a
 * second sample.
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
/**
 * The caption names a backdrop, so it is painted only when there is one.
 */
const CAPTION = "ui.settings.appearance.layers.preview.sample_backdrop";

export const AppearancePreviewStrip: FC<{
	/** A scoped `[data-theme]` id to paint instead of the document's palette. */
	previewTheme?: string;
	className?: string;
	glass?: WindowGlassState | null;
	/** `compact` keeps the chat pair and sidebar rows for an inline companion. */
	variant?: "full" | "compact";
}> = ({ previewTheme, className, glass, variant = "full" }) => {
	useI18nLocale();
	/* The sample's alphas follow ITS painted palette, so a drag candidate is not
	 * described by the document's last verified composition. */
	const ref = useRef<HTMLElement | null>(null);
	const [preview, setPreview] = useState<PreviewGlass>({ kind: "solid" });
	/* The composition is the palette-change SIGNAL. The palette reaches the strip
	 * as inherited `--lo-*` that a theme, contrast or accent commit rewrites on
	 * `:root`; `glass.state` keeps its identity across a scheme report and a drag
	 * candidate keeps its scoped id, so those two deps alone left the sample
	 * painting the previous palette's floors (code R1, QA Q-1). Subscribing here
	 * re-runs the read on the commit that repainted the roles, and the scheme
	 * fallback comes from the same composition instead of the document's own
	 * class, so a light palette is never measured with a dark tier (code M1). */
	const resolved = useResolvedAppearance();
	useLayoutEffect(() => {
		/* The scoped id selects WHICH `--lo-*` block this section inherits, so a change
		   of id has to re-read even though it is never passed to the solver. The id is
		   not sufficient on its own: a candidate rewrite keeps the same id (the one-rAF
		   re-read below is for that), and a theme commit changes the palette without
		   touching the id at all - which is why `resolved` is a dependency too. */
		void previewTheme;
		const apply = () =>
			setPreview(
				previewGlassState(
					glass,
					readPreviewPalette(ref.current),
					resolved.palette.mode,
				),
			);
		apply();
		/* `previewCss` writes the candidate block in the PARENT's layout effect, which
		   runs after this child's; one frame later the painted values are the ones to
		   measure. An alpha-only update, so nothing reflows. */
		const frame = requestAnimationFrame(apply);
		return () => cancelAnimationFrame(frame);
	}, [glass, previewTheme, resolved]);
	const paint = preview.kind === "glass" ? preview.paint : null;
	return (
		<section
			ref={ref}
			aria-label={t("ui.settings.appearance.layers.preview_label")}
			data-appearance-preview=""
			data-preview-variant={variant}
			data-theme={previewTheme}
			data-preview-glass={paint?.kinds ?? ""}
			style={
				{
					...paint?.vars,
					...(preview.kind === "glass"
						? previewBackdropVars(preview.scheme)
						: null),
				} as CSSProperties
			}
			className={cn(
				"appearance-preview rounded-md border border-hairline",
				className,
			)}
		>
			{/* The sample's accessible name, made visible: without it the composite is
			    only identifiable as "the user's theme" to someone who already knows
			    (UX U3). It is also what the state line below belongs to.
			    `data-preview-chrome` gives it the canvas region's ground: it is text on
			    the panel, not text on the desktop the panel floats over (code C1).
			    Rounded on the outer edge because the card's own corners are. */}
			<div
				data-preview-chrome=""
				className="rounded-t-md px-2 pt-1.5 pb-1 text-ink-dim text-meta"
			>
				{t("ui.settings.appearance.layers.preview_label")}
			</div>
			<div
				data-preview-samples=""
				/* Set as an attribute, the way `quote-toolkit.tsx` does: React 18's
				   DOM types have no `inert` prop. */
				ref={setInert}
				aria-hidden="true"
				className={cn(
					"gap-2 rounded-md p-2 text-ink",
					variant === "compact"
						? "flex flex-col"
						: "grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] items-start",
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
						className="flex items-center gap-2 rounded-md border border-control bg-sunken px-2 py-1.5"
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
				{/* 4. Buttons and 5. callouts - the column the compact variant drops */}
				{variant === "full" ? (
					/* Dropped below `sm`: at a narrow window the buttons/callouts column is
					   what pushed the in-flow sample to 63% of the viewport (design D4), and
					   the two text-bearing columns are the ones the sample exists for. */
					<div
						data-preview-region="canvas"
						className="hidden min-w-0 flex-col gap-1.5 rounded-md bg-canvas p-1 sm:flex"
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
				) : null}
			</div>
			{/* The caption is the header's counterpart and takes the same ground
			    (`[data-preview-chrome]`), never a flat fill of its own: an opaque bar
			    inside a translucent card is what N2 removed, and no bar at all left the
			    label at 3.3:1 in glass (code C1, UX U5, design D5). */}
			{preview.kind === "glass" ? (
				<div
					data-preview-caption=""
					data-preview-chrome=""
					className="rounded-b-md px-2 pt-1 pb-1.5 text-ink-dim text-meta"
				>
					{t(CAPTION)}
				</div>
			) : null}
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
