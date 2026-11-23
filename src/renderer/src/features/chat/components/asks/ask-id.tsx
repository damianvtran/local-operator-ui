/**
 * THE ASK ID, AND THE ONE CONTROL THAT COPIES IT (design spec, D13).
 *
 * An ask id is the string a user quotes back at an agent ("a-745e"), so it has to
 * be visible, readable and copyable from the card. The card used to draw the id as
 * a blank span whose only content was a hover `title` - invisible to touch and to
 * the keyboard, uncopyable, and unreadable in a screenshot - which is the defect
 * this component replaces.
 *
 * WHY ITS OWN MODULE rather than a span in each call site: the pending card's
 * foot and a settled row both draw the id, and two renderings would drift into
 * two answers to "does it copy?" - the same argument `ask-recommended.tsx`
 * carries. The clipboard write and its failure toast follow the shared
 * `CopyButton` (`shared/components/common/copy-button.tsx`) and `copy-session-id`
 * precedent, including its two keys (`ui.common.actions.copied` and
 * `copy_failed`); what differs is the presentation, because the foot's id is a
 * 12px mono token in a 24px row, not a labelled 32px button.
 *
 * 1.5s of "Copied" is the spec's number; the shared button uses 2s. The word is
 * also a polite live region, so a screen reader hears the confirmation without
 * the button changing its accessible name (which stays "Copy ask id a-745e").
 */
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../../../../i18n/messages";

const COPIED_MS = 1500;

export const AskId = ({
	id,
	className,
}: {
	id: string;
	className?: string;
}) => {
	useI18nLocale();
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);
	useEffect(
		() => () => {
			window.clearTimeout(timer.current);
		},
		[],
	);
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
			<button
				type="button"
				aria-label={t("ui.chat.asks.copy_id", { id })}
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(id);
						setCopied(true);
						window.clearTimeout(timer.current);
						timer.current = window.setTimeout(
							() => setCopied(false),
							COPIED_MS,
						);
					} catch {
						showErrorToast(t("ui.common.actions.copy_failed"));
					}
				}}
				className="inline-flex min-h-6 items-center gap-1 rounded-sm px-1 font-mono text-ink-muted text-mono-sm hover:bg-row-hover hover:text-ink"
			>
				{/*
				 * The id is the button's visible text and the copy glyph is its
				 * affordance; `aria-label` is the name, so the glyph needs no text of
				 * its own. The id keeps `[overflow-wrap:anywhere]` off deliberately:
				 * an ask id is six characters, and a wrapping id would be a lie about
				 * the one string the user is here to copy.
				 */}
				<span>{id}</span>
				{copied ? (
					<Check aria-hidden="true" className="size-3 shrink-0" />
				) : (
					<Copy aria-hidden="true" className="size-3 shrink-0" />
				)}
			</button>
			{/*
			 * A separate live region rather than the button's own text: the button's
			 * accessible name is the action, so a name that swapped to "Copied" would
			 * rename the control on the press. `<output>` is the native element for a
			 * status region (its implicit role is `status`, polite). Only the pressed
			 * card's region changes.
			 */}
			<output className="sr-only">
				{copied ? t("ui.common.actions.copied") : ""}
			</output>
		</span>
	);
};
