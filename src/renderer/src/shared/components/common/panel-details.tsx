import { Button } from "@shared/components/ui";
import { withPathBreaks } from "@shared/lib/path-breaks";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Machine voice at the bottom of a panel, labelled and copyable.
 *
 * It used to sit directly above the buttons, unlabelled and at 12px mono, so the
 * last thing the eye crossed before the primary action was an OSStatus code -
 * and the only way to get that code into a support report was to hand-select a
 * wrapped path (reviews D2, D6, U11). It is below the actions now, it says what
 * it is, and one click copies it, which is the affordance the rest of the app
 * already has for the same job.
 *
 * WHY IT IS ITS OWN MODULE. It moved out of `update-notification.tsx` when the
 * update FAILURE alert needed the same line: that alert is rendered by
 * `UpdateErrorAlert`, which `update-notification.tsx` imports, so reaching back
 * for this component would have been an import cycle over a presentational
 * detail. Design round 1's D4 asked this family to use one idiom - the panels
 * label their machine detail and let it be copied, and a bare unlabelled mono
 * line in a callout read as stray rather than as evidence - and one module is
 * what makes "one idiom" checkable.
 *
 * TWO ARRANGEMENTS, ONE IDIOM: `stacked` is the narrow case (see its own note
 * below). The label, the value's register and the copy control are the same in
 * both, so the two surfaces still read as one pattern rather than two.
 */
export const PanelDetails = ({
	detail,
	stacked = false,
}: {
	detail: string;
	/**
	 * Put the copy control under the value rather than beside it.
	 *
	 * WHY THE ALERT ASKS FOR THIS AND THE PANELS DO NOT. The panels are wide and the
	 * row fits; the failure alert is a fixed 400px box with a 40px dismiss reserve,
	 * where the label, a `net::ERR_NETWORK_CHANGED` and a named button measure past
	 * the content width - and the wrap `break-words` then takes lands INSIDE the
	 * code, which renders `net::ERR_NETWORK_CHAN` / `GED` and reads as a different
	 * constant (design round 1's frames caught it). Stacked, the code keeps its
	 * width and the button keeps its label. The panels are untouched, so their
	 * eighteen committed frames stay byte-identical.
	 */
	stacked?: boolean;
}) => {
	const [copied, setCopied] = useState(false);
	/* Named, not a bare "Copy": both by-hand panels carry a copy button beside the
	   command well as well as this one, and only position said which copied what
	   (review D12). */
	const copy = (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => {
				void navigator.clipboard
					.writeText(detail)
					.then(() => setCopied(true))
					.catch(() => undefined);
			}}
		>
			{copied ? <Check /> : <Copy />}
			{copied ? "Copied" : "Copy details"}
		</Button>
	);
	return (
		<div
			className={
				stacked
					? "mt-4 flex flex-col items-start gap-1"
					: "mt-4 flex items-start gap-2"
			}
		>
			{stacked ? (
				<>
					<span className="text-meta text-ink-dim">Details:</span>
					<span className="font-mono text-mono-sm break-all text-ink-dim">
						{withPathBreaks(detail)}
					</span>
					{copy}
				</>
			) : (
				<>
					<span className="shrink-0 text-meta text-ink-dim">Details:</span>
					{/* `font-mono` and not only `text-mono-sm`: the latter is a SIZE token
					    (0.75rem), so the value rendered in the body face and a path or an
					    OSStatus constant lost the distinction between l/I/1 and 0/O that
					    monospace exists for here, while the evidence README claimed the
					    machine voice (review D10). The label stays sans: it is a word. */}
					<span className="min-w-0 flex-1 break-words font-mono text-mono-sm text-ink-dim">
						{withPathBreaks(detail)}
					</span>
					{copy}
				</>
			)}
		</div>
	);
};
