import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";

/** The library's state, independent of storage timing, so empty/corrupt/loading
 * states have the same presentation in settings and deterministic stories. */
export const CustomThemeStatus = ({
	loading,
	error,
	count,
	onRetry,
}: {
	loading: boolean;
	error: boolean;
	count: number;
	onRetry: () => void;
}) => {
	useI18nLocale();
	if (loading)
		return (
			<p aria-live="polite" className="text-meta text-ink-muted">
				{t("ui.settings.appearance.editor.loading")}
			</p>
		);
	if (error)
		return (
			<div className="text-meta text-danger" role="alert">
				{t("ui.settings.appearance.editor.load_error")}{" "}
				<Button variant="ghost" size="sm" onClick={onRetry}>
					{t("ui.settings.appearance.editor.retry")}
				</Button>
			</div>
		);
	if (count === 0)
		return (
			<p className="text-meta text-ink-muted">
				{t("ui.settings.appearance.editor.empty")}
			</p>
		);
	return null;
};
