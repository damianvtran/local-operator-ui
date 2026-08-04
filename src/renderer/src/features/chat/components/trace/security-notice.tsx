/**
 * A security notice — retrospective by contract.
 *
 * docs/branding.md § 7: a security notice "records that a risk was reviewed
 * and averted. It must not be styled as a prompt, because nothing consumes a
 * response to it." So: the warning triple (the one semantic that means
 * caution), past-tense title, no buttons, no input affordance, and any
 * technical payload behind the one disclosure idiom, closed by default.
 *
 * ## Why it is a rule and not a box
 *
 * The § 7 hierarchy puts the notice at tier 4 and the question at tier 1, but
 * as a filled, fully-bordered `Alert` it was drawn *larger and heavier* than
 * the accent question callout directly below it — the two competed, and the
 * one you had to act on lost. Two washed boxes stacked in one turn is also
 * exactly the "cards inside cards" noise the system warns about.
 *
 * A left warning rule keeps every property that matters — findable while
 * scrolling, unmistakably a caution, colour plus a glyph rather than colour
 * alone — and gives up only the fill, which was carrying no information. The
 * body drops to `ink-muted`, which the contract measures at 4.5:1 on all four
 * grounds, where warning-on-warning-wash is measured only as a pair.
 *
 * Replaces `security-check-highlight.tsx`, which styled the notice like an
 * alert banner with a solid "AI SECURITY BLOCK" badge — shouty caps, a fill
 * the palette contract never verified, and a shadow.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

export type SecurityNoticeProps = {
	/** The notice text recorded by the security check. */
	content?: string;
	/** Technical payload (code, output, logs) behind the disclosure. */
	details?: ReactNode;
	/** Extra classes on the notice. */
	className?: string;
};

export const SecurityNotice = ({
	content,
	details,
	className,
}: SecurityNoticeProps) => (
	<section
		aria-label="Security notice"
		className={cn(
			"flex gap-3 border-warning border-l-2 py-0.5 pl-3",
			className,
		)}
	>
		<ShieldAlert
			className="mt-0.5 size-4 shrink-0 text-warning"
			aria-hidden={true}
		/>
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<p className="font-medium text-body-sm text-warning">
				Blocked a risky action
			</p>
			{content ? (
				<p className="text-body-sm text-ink-muted">{content}</p>
			) : null}
			{details ? (
				<Disclosure
					summary={<span className="text-meta">Show the reviewed code</span>}
					triggerClassName="min-h-6 py-0.5"
					contentClassName="ml-5 mt-1 flex flex-col gap-2 pb-1"
				>
					{details}
				</Disclosure>
			) : null}
		</div>
	</section>
);
