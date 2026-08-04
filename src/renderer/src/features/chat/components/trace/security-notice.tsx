/**
 * A security notice — retrospective by contract.
 *
 * docs/branding.md § 7: a security notice "records that a risk was reviewed
 * and averted. It must not be styled as a prompt, because nothing consumes a
 * response to it." So: the warning triple (the one semantic that means
 * caution), past-tense title, no buttons, no input affordance, and any
 * technical payload behind the one disclosure idiom, closed by default.
 *
 * Replaces `security-check-highlight.tsx`, which styled the notice like an
 * alert banner with a solid "AI SECURITY BLOCK" badge — shouty caps, a fill
 * the palette contract never verified, and a shadow.
 */

import { Alert, AlertDescription, AlertTitle } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Disclosure } from "./disclosure";

export type SecurityNoticeProps = {
	/** The notice text recorded by the security check. */
	content?: string;
	/** Technical payload (code, output, logs) behind the disclosure. */
	details?: ReactNode;
	/** Extra classes on the callout. */
	className?: string;
};

export const SecurityNotice = ({
	content,
	details,
	className,
}: SecurityNoticeProps) => (
	<Alert
		variant="warning"
		icon={<ShieldAlert className="size-4" aria-hidden={true} />}
		className={cn("shadow-none", className)}
	>
		<AlertTitle>Blocked a risky action</AlertTitle>
		{content ? (
			<AlertDescription className="text-warning">{content}</AlertDescription>
		) : null}
		{details ? (
			<Disclosure
				summary={<span className="text-meta">Show the reviewed code</span>}
				triggerClassName="min-h-6 py-0.5 text-warning hover:text-warning"
				contentClassName="ml-5 mt-1 flex flex-col gap-2 pb-1"
			>
				{details}
			</Disclosure>
		) : null}
	</Alert>
);
