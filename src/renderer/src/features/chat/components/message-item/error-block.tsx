/**
 * Component for displaying error output (stderr), in the danger triple.
 *
 * The suggestion box maps well-known failures to a sentence in the user's
 * terms — what happened, what it means, what to do (§ 8). Its links go
 * through the same react-router Link the rest of the app uses; MuiLink was
 * the only reason this file knew about MUI.
 */

import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Info } from "lucide-react";
import type { FC } from "react";
import { Link } from "react-router-dom";

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
 * that section — the providers link used to render the word "Providers" over a
 * bare `/settings`, so the reader who followed it landed on General, the same
 * dead-end class this area was just fixed for (design review round 2, D7).
 * Callers that mean the whole page keep the default.
 *
 * The label is a KEY, not a string: `t()` is called when this helper renders,
 * which is the only moment the active locale is known.
 */
const settingsLink = (
	labelKey:
		| "ui.chat.error_block.link.settings"
		| "ui.chat.error_block.link.providers" = "ui.chat.error_block.link.settings",
	to = "/settings",
) => (
	<Link to={to} className="text-accent underline underline-offset-2">
		{t(labelKey)}
	</Link>
);

/*
 * WHY THIS TABLE HOLDS MATCHERS AND NOT SENTENCES.
 *
 * The map used to be `Record<backend token, ReactNode>` of English sentences,
 * built at module load. `t()` resolves against the locale that is active when
 * it is CALLED, so a module-scope table would answer once — at import — and
 * keep answering English after a language switch. The tokens on the left are
 * machine strings matched against the wire's error text (`toLowerCase()`), so
 * they stay English by contract; the copy is built during render, in
 * `suggestionFor` below.
 *
 * Each sentence is split around its settings link because `t()` returns TEXT,
 * not elements: the clause before the link and the clause after it are
 * separate keys, and the link's label is a third. That split is the cost of
 * keeping a real <Link> inside the sentence — a single string could not route
 * the reader anywhere. Translators get the two halves plus the link label with
 * the sentence's context in `ui.chat.error_block.context.json`, so the halves
 * must be translated as one sentence.
 */
type SuggestionKind =
	| "provider"
	| "model"
	| "rate_limit"
	| "rate_limit_all"
	| "invalid_key"
	| "unavailable"
	| "schema";

const SUGGESTION_MATCHERS: readonly (readonly [string, SuggestionKind])[] = [
	["Hosting platform is not configured", "provider"],
	["Model name is not configured", "model"],
	["Rate limit", "rate_limit"],
	["Rate-limit", "rate_limit_all"],
	["Invalid API key", "invalid_key"],
	["404 models", "unavailable"],
	["Call ListModels", "unavailable"],
	["Failed to interpret action", "schema"],
];

/** The suggestion sentence for a matched backend failure, in the active locale. */
const suggestionFor = (kind: SuggestionKind): React.ReactNode => {
	switch (kind) {
		case "provider":
			return (
				<p>
					{t("ui.chat.error_block.provider.before")} {settingsLink()}{" "}
					{t("ui.chat.error_block.provider.after")}
				</p>
			);
		case "model":
			return (
				<p>
					{t("ui.chat.error_block.model.before")} {settingsLink()}{" "}
					{t("ui.chat.error_block.model.after")}
				</p>
			);
		case "rate_limit":
			return (
				<p>
					{t("ui.chat.error_block.rate_limit.before")} {settingsLink()}{" "}
					{t("ui.chat.error_block.rate_limit.after")}
				</p>
			);
		case "rate_limit_all":
			return (
				<p>
					{t("ui.chat.error_block.rate_limit.before")} {settingsLink()}{" "}
					{t("ui.chat.error_block.rate_limit.all_after")}
				</p>
			);
		case "invalid_key":
			return (
				<p>
					{t("ui.chat.error_block.invalid_key.before")}{" "}
					{settingsLink(
						"ui.chat.error_block.link.providers",
						"/settings?section=providers",
					)}
					{t("ui.chat.error_block.invalid_key.after")}
				</p>
			);
		case "unavailable":
			return (
				<p>
					{t("ui.chat.error_block.unavailable.before")} {settingsLink()}{" "}
					{t("ui.chat.error_block.unavailable.after")}
				</p>
			);
		case "schema":
			return (
				<p>
					{t("ui.chat.error_block.schema.before")}
					<br />
					<br />
					{t("ui.chat.error_block.schema.after_before")} {settingsLink()}{" "}
					{t("ui.chat.error_block.schema.after")}
				</p>
			);
	}
};

export const ErrorBlock: FC<ErrorBlockProps> = ({ error }) => {
	// `t()` reads the current locale at call time; this subscription is what
	// makes an error block already on screen follow a language switch.
	useI18nLocale();
	if (!error || error === "[No error output]") return null;

	const lowercasedTrimmedError = error.trim().toLowerCase();
	let suggestion: React.ReactNode | undefined;
	for (const [token, kind] of SUGGESTION_MATCHERS) {
		if (lowercasedTrimmedError.includes(token.toLowerCase())) {
			suggestion = suggestionFor(kind);
			break;
		}
	}

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-danger text-meta">
				{t("ui.chat.error_block.heading")}
			</span>
			<pre className="flex max-h-[200px] w-full flex-col-reverse overflow-auto whitespace-pre-wrap rounded-sm border border-danger-border bg-danger-wash p-3 font-mono text-danger text-mono-sm">
				{error}
			</pre>
			{suggestion && (
				<div className="mt-3 flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface p-3">
					<Info className="size-4 shrink-0 text-ink-muted" aria-hidden={true} />
					<div className="text-body-sm text-ink">{suggestion}</div>
				</div>
			)}
		</div>
	);
};
