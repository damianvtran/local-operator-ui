import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";

/** A retained request is recovery work, not ordinary sending chrome. Keep its
 * explanation and actions in the composer flow, and let audited locale labels
 * wrap instead of truncating the acknowledgement that releases the draft. */
export function TeamBridgeHeldAttempt({
	reasonId,
	busy,
	onRetry,
	onDiscard,
}: {
	reasonId: string;
	busy: boolean;
	onRetry?: () => void;
	onDiscard: () => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2 px-3.5 pt-3 text-sm text-ink-muted">
			<p id={reasonId}>{t("ui.teamBridge.schedule.held")}</p>
			<div className="flex min-w-0 flex-col items-stretch gap-1">
				{onRetry && (
					<Button
						variant="primary"
						className="h-auto min-h-8 w-full max-w-full justify-start whitespace-normal py-1.5 text-left [overflow-wrap:anywhere]"
						disabled={busy}
						onClick={onRetry}
					>
						{t("ui.teamBridge.schedule.retry")}
					</Button>
				)}
				<Button
					variant="ghost"
					className="h-auto min-h-8 w-full max-w-full justify-start whitespace-normal py-1.5 text-left text-danger hover:text-danger [overflow-wrap:anywhere]"
					disabled={busy}
					onClick={onDiscard}
				>
					{t("ui.teamBridge.schedule.discard_attempt")}
				</Button>
			</div>
		</div>
	);
}
