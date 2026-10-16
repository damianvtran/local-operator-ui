import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Check, Copy } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { Button } from "../ui";

/**
 * A copy button that says "Copied" for two seconds, then goes back.
 *
 * Shared (moved out of the provider panel unchanged) because the Phone access
 * block copies an address the same way, and a second clipboard implementation
 * beside this one would drift on the failure toast.
 *
 * ITS COPY IS `ui.common.actions.*`, deliberately NOT `ui.providers.*`. The
 * component serves a provider panel and the phone-access block today, and any
 * screen that copies a value tomorrow; a shared component reaching into one
 * caller's namespace would make the other caller's translators maintain copy
 * they do not own. The provider panel still owns its own per-action labels
 * (`Copy code`, `Copy link`), which its callers pass in as `label`.
 *
 * `useI18nLocale` subscribes this leaf: `t()` reads the store at call time, so
 * without it the button keeps the locale it first rendered under.
 */
export const CopyButton: FC<{
	value: string;
	label: string;
	variant?: "ghost" | "secondary" | "primary";
	onCopied?: () => void;
}> = ({ value, label, variant = "ghost", onCopied }) => {
	useI18nLocale();
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return undefined;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<Button
			variant={variant}
			size="sm"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					onCopied?.();
				} catch {
					showErrorToast(t("ui.common.actions.copy_failed"));
				}
			}}
		>
			{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			{copied ? t("ui.common.actions.copied") : label}
		</Button>
	);
};
