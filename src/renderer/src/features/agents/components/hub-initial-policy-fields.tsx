import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useEffect, useId, useRef, useState } from "react";

export type InitialHubPolicy = {
	subscribe: boolean;
	autoPush: boolean;
	confirmPublicEgress: boolean;
};
export const newHubPolicy = (): InitialHubPolicy => ({
	subscribe: true,
	autoPush: false,
	confirmPublicEgress: false,
});

/**
 * Checkboxes are DRAFT form values, unlike the acknowledged live switches. The
 * caller sends them atomically with publication/linking and checks the durable
 * local receipt. Target changes invalidate consent; this is never a terms box.
 */
export function HubInitialPolicyFields({
	value,
	onChange,
	source,
	item,
	visibility,
	organization,
	destinationKey,
	canEnableAutoPush,
	disabled = false,
}: {
	value: InitialHubPolicy;
	onChange: (value: InitialHubPolicy) => void;
	source: string;
	item: string;
	visibility: "public" | "org";
	organization: string | null;
	destinationKey: string;
	canEnableAutoPush: boolean;
	disabled?: boolean;
}) {
	useI18nLocale();
	const id = useId();
	const cancel = useRef<HTMLButtonElement>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	useEffect(() => {
		if (confirming !== null && confirming !== destinationKey)
			setConfirming(null);
	}, [confirming, destinationKey]);
	return (
		<div className="flex flex-col gap-3" data-initial-hub-policy>
			<p className="text-meta text-ink-muted">
				{t("ui.hub.skills.initial_policy_description")}
			</p>
			{(["subscribe", "autoPush"] as const).map((field) => (
				<label
					key={field}
					htmlFor={`${id}-${field}`}
					className="flex items-start gap-3 text-body-sm text-ink"
				>
					<Checkbox
						id={`${id}-${field}`}
						checked={value[field]}
						disabled={
							disabled ||
							(field === "autoPush" && !canEnableAutoPush && !value.autoPush)
						}
						onCheckedChange={(checked) => {
							if (field === "subscribe")
								onChange({ ...value, subscribe: checked === true });
							else if (checked !== true)
								onChange({
									...value,
									autoPush: false,
									confirmPublicEgress: false,
								});
							else if (canEnableAutoPush) setConfirming(destinationKey);
						}}
					/>
					<span>
						<span className="block">
							{t(
								field === "subscribe"
									? "ui.hub.subscriptions.subscribe"
									: "ui.hub.subscriptions.auto_push",
							)}
						</span>
						<span className="block text-meta text-ink-muted">
							{t(
								field === "subscribe"
									? "ui.hub.subscriptions.subscribe_description"
									: "ui.hub.subscriptions.auto_push_description",
								{ source },
							)}
						</span>
					</span>
				</label>
			))}
			{!canEnableAutoPush && (
				<p className="text-meta text-ink-muted">
					{t("ui.hub.subscriptions.unsupported")}
				</p>
			)}
			<Dialog
				open={confirming !== null}
				onOpenChange={(open) => {
					if (!open) setConfirming(null);
				}}
			>
				<DialogContent
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						cancel.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t("ui.hub.subscriptions.enable_title", { source })}
						</DialogTitle>
						<DialogDescription>
							{visibility === "public"
								? t("ui.hub.subscriptions.enable_public", { item })
								: t("ui.hub.subscriptions.enable_private", {
										item,
										organization: organization ?? source,
									})}
						</DialogDescription>
					</DialogHeader>
					<p className="text-body-sm text-ink-muted">
						{t("ui.hub.subscriptions.enable_safety")}
					</p>
					<DialogFooter>
						<Button
							ref={cancel}
							data-testid="hub-policy-cancel"
							variant="outline"
							onClick={() => setConfirming(null)}
						>
							{t("ui.hub.subscriptions.cancel")}
						</Button>
						<Button
							data-testid="hub-policy-enable"
							disabled={
								disabled || !canEnableAutoPush || confirming !== destinationKey
							}
							onClick={() => {
								onChange({
									...value,
									autoPush: true,
									confirmPublicEgress: visibility === "public",
								});
								setConfirming(null);
							}}
						>
							{t("ui.hub.subscriptions.enable")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
