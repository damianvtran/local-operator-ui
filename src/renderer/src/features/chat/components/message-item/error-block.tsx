/**
 * Component for displaying error output (stderr), in the danger triple.
 *
 * The suggestion box maps well-known failures to a sentence in the user's
 * terms — what happened, what it means, what to do (§ 8). Its links go
 * through the same react-router Link the rest of the app uses; MuiLink was
 * the only reason this file knew about MUI.
 */

import { useI18nLocale } from "@shared/i18n/use-locale";
import { Info } from "lucide-react";
import type { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import { t } from "../../../../../../i18n/messages";

/**
 * Props for the ErrorBlock component
 */
export type ErrorBlockProps = {
	error: string;
	isUser: boolean;
};

/*
 * A link INTO the settings page, with an optional literal `to`.
 *
 * `to` is a full path/query STRING written at the call site rather than a
 * section id interpolated in here, and that is deliberate: `settings-page.tsx`
 * resolves `?section=` against its own `sectionRefs`, and the route scan
 * (`scripts/settings-section-routes.test.mjs`) can only verify a route whose
 * section is a LITERAL in the source. A label that NAMES a section must carry
 * that section — `settingsLink("Providers section")` used to render the word
 * "Providers" over a bare `/settings`, so the reader who followed it landed on
 * General, the same dead-end class this area was just fixed for (design review
 * round 2, D7). Callers that mean the whole page keep the default.
 */
const SETTINGS_LINK_MARKER = "__SETTINGS_LINK__";

/*
 * ICU owns the whole sentence and the link's position. Splitting only the
 * formatted placeholder lets React keep the router link without making
 * translators reorder fragments whose grammar depends on one another.
 */
const linkedSettingsSentence = (text: string, providers = false): ReactNode => {
	const parts = text.split(SETTINGS_LINK_MARKER);
	if (parts.length !== 2) return text;
	return (
		<>
			{parts[0]}
			<Link
				to={
					providers
						? t("ui.chat.message.error_block.settings_section_providers")
						: "/settings"
				}
				className="text-accent underline underline-offset-2"
			>
				{t(
					providers
						? "ui.chat.message.error_block.providers_section"
						: "ui.chat.message.error_block.settings_page",
				)}
			</Link>
			{parts[1]}
		</>
	);
};

type ErrorSuggestion = {
	key:
		| "hosting"
		| "model"
		| "rate_limit"
		| "rate_limit_all"
		| "invalid_key"
		| "model_unavailable"
		| "schema";
	providers?: boolean;
};

const errorSuggestions: Record<string, ErrorSuggestion> = {
	"Hosting platform is not configured": { key: "hosting" },
	"Model name is not configured": { key: "model" },
	"Rate limit": { key: "rate_limit" },
	"Rate-limit": { key: "rate_limit_all" },
	"Invalid API key": { key: "invalid_key", providers: true },
	"404 models": { key: "model_unavailable" },
	"Call ListModels": { key: "model_unavailable" },
	"Failed to interpret action": { key: "schema" },
};

export const ErrorBlock: FC<ErrorBlockProps> = ({ error }) => {
	useI18nLocale();
	if (!error || error === "[No error output]") return null;

	const lowercasedTrimmedError = error.trim().toLowerCase();
	let suggestion: ErrorSuggestion | undefined;
	for (const key in errorSuggestions) {
		if (lowercasedTrimmedError.includes(key.toLowerCase())) {
			suggestion = errorSuggestions[key];
			break;
		}
	}
	const settingsText = (key: ErrorSuggestion["key"]) => {
		const params = { settings: SETTINGS_LINK_MARKER };
		switch (key) {
			case "hosting":
				return t("ui.chat.message.error_block.hosting", params);
			case "model":
				return t("ui.chat.message.error_block.model", params);
			case "rate_limit":
				return t("ui.chat.message.error_block.rate_limit", params);
			case "rate_limit_all":
				return t("ui.chat.message.error_block.rate_limit_all", params);
			case "invalid_key":
				return t("ui.chat.message.error_block.invalid_key", params);
			case "model_unavailable":
				return t("ui.chat.message.error_block.model_unavailable", params);
			case "schema":
				return t("ui.chat.message.error_block.schema_remedy", params);
		}
	};

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-danger text-meta">
				{t("ui.chat.message.error_block.error")}
			</span>
			<pre className="flex max-h-[200px] w-full flex-col-reverse overflow-auto whitespace-pre-wrap rounded-sm border border-danger-border bg-danger-wash p-3 font-mono text-danger text-mono-sm">
				{error}
			</pre>
			{suggestion && (
				<div className="mt-3 flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface p-3">
					<Info className="size-4 shrink-0 text-ink-muted" aria-hidden={true} />
					<div className="text-body-sm text-ink">
						{suggestion.key === "schema" ? (
							<p>
								{t("ui.chat.message.error_block.schema_explanation")}
								<br />
								<br />
								{linkedSettingsSentence(
									t("ui.chat.message.error_block.schema_remedy", {
										settings: SETTINGS_LINK_MARKER,
									}),
								)}
							</p>
						) : (
							<p>
								{linkedSettingsSentence(
									settingsText(suggestion.key),
									suggestion.providers,
								)}
							</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
};
