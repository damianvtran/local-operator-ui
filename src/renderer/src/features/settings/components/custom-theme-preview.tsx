import { Button, Input } from "@shared/components/ui";
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";

/** A compact picture of the real role/component families, not another app.
 * Inert prevents phantom tab stops. Unlike the gallery's broad preview strip,
 * this two-column composition leaves the essential colour controls in reach
 * in a 560px drawer. Only this subtree receives the draft's shared CSS block.
 */
export const CustomThemePreview = ({ id }: { id: string }) => {
	useI18nLocale();
	return (
		<section
			aria-label={t("ui.settings.appearance.editor.preview")}
			data-custom-theme-preview=""
		>
			<div
				data-theme={id}
				ref={(node) => {
					node?.setAttribute("inert", "");
				}}
				aria-hidden="true"
				className="grid min-w-0 grid-cols-2 gap-2 rounded-md bg-canvas p-2 text-ink"
			>
				<div className="flex min-w-0 flex-col gap-1">
					<p className="self-end rounded-sm bg-message-surface px-2 py-1 text-meta">
						{t("ui.settings.appearance.editor.preview.user")}
					</p>
					<p className="text-meta text-ink-muted">
						{t("ui.settings.appearance.editor.preview.assistant")}
					</p>
				</div>
				<div className="min-w-0 rounded-sm bg-surface p-1 text-meta">
					<div className="truncate px-1 py-0.5 text-ink-muted">
						{t("ui.settings.appearance.editor.preview.sidebar")}
					</div>
					<div className="truncate rounded-xs bg-row-hover px-1 py-0.5">
						{t("ui.settings.appearance.editor.preview.normal")}
					</div>
					<div className="flex items-center justify-between gap-1 rounded-xs bg-row-selected px-1 py-0.5">
						<span className="truncate">
							{t("ui.settings.appearance.editor.preview.selected")}
						</span>
						<AttentionBadge count={3} />
					</div>
				</div>
				<div className="flex min-w-0 items-center gap-1 rounded-sm border border-control bg-sunken px-1 py-1">
					<span className="min-w-0 flex-1 truncate text-meta text-ink-dim">
						{t("ui.settings.appearance.editor.preview.composer")}
					</span>
					<Button variant="primary" size="sm" tabIndex={-1}>
						{t("ui.settings.appearance.editor.preview.send")}
					</Button>
				</div>
				<div className="flex flex-wrap items-center gap-1">
					<Button variant="primary" size="sm" tabIndex={-1}>
						{t("ui.settings.appearance.editor.preview.primary")}
					</Button>
					<Button size="sm" variant="secondary" tabIndex={-1}>
						{t("ui.settings.appearance.editor.preview.secondary")}
					</Button>
					<Button size="sm" disabled tabIndex={-1}>
						{t("ui.settings.appearance.editor.preview.disabled")}
					</Button>
				</div>
				<div className="flex min-w-0 flex-col gap-1 text-meta">
					<div className="rounded-xs border border-success-border bg-success-wash px-1 text-success">
						{t("ui.settings.appearance.editor.preview.success")}
					</div>
					<div className="rounded-xs border border-warning-border bg-warning-wash px-1 text-warning">
						{t("ui.settings.appearance.editor.preview.warning")}
					</div>
					<div className="rounded-xs border border-danger-border bg-danger-wash px-1 text-danger">
						{t("ui.settings.appearance.editor.preview.danger")}
					</div>
				</div>
				<div className="grid min-w-0 grid-cols-2 gap-1">
					<pre className="overflow-hidden rounded-sm bg-sunken p-1 font-mono text-meta text-token-command">
						<code>{"const x = {\n ready: true\n};"}</code>
					</pre>
					<div className="min-w-0 rounded-sm bg-elevated p-1 text-meta">
						<div className="truncate rounded-xs bg-row-hover px-1">
							{t("ui.settings.appearance.editor.preview.menu_item")}
						</div>
						<div className="truncate px-1 text-danger">
							{t("ui.settings.appearance.editor.preview.menu_danger")}
						</div>
					</div>
				</div>
				<Input
					inputSize="sm"
					readOnly
					tabIndex={-1}
					aria-label={t("ui.settings.appearance.editor.preview.input")}
					value={t("ui.settings.appearance.editor.preview.input")}
					className="outline-2 outline-accent"
				/>
				<div className="flex min-w-0 items-center gap-1 rounded-sm bg-row-selected p-1">
					<span className="size-2 shrink-0 rounded-full bg-success" />
					<span className="truncate text-meta">
						{t("ui.settings.appearance.editor.preview.bridge_name")}
					</span>
					<AttentionBadge count={3} />
					<span className="text-meta text-ink-dim">{12}</span>
				</div>
				<div className="col-span-2 rounded-xs border border-info-border bg-info-wash px-1 text-meta text-info">
					{t("ui.settings.appearance.editor.preview.info")}
				</div>
			</div>
		</section>
	);
};
