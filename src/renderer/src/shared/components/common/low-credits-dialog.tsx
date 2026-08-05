import RadientIcon from "@renderer/assets/radient-icon-1024x1024.png";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { useRadientPricesQuery } from "@shared/hooks/use-radient-prices-query";
import { useLowCreditsStore } from "@shared/store/low-credits-store";
import { ExternalLink } from "lucide-react";
import type { FC } from "react";
import { BaseDialog, PrimaryButton, SecondaryButton } from "./base-dialog";

export type LowCreditsDialogProps = {
	open: boolean;
	onClose: () => void;
	onGoToConsole: () => void;
};

export const LowCreditsDialog: FC<LowCreditsDialogProps> = ({
	open,
	onClose,
	onGoToConsole,
}) => {
	const { setHasBeenNotified } = useLowCreditsStore();
	const {
		prices,
		isLoading: isLoadingPrices,
		error: pricesError,
	} = useRadientPricesQuery();

	const formatCurrency = (amount: number | undefined) => {
		if (typeof amount !== "number") return "$..."; // Fallback for loading/error
		return `$${amount.toFixed(2)} USD`; // Basic USD formatting
	};

	const handleClose = () => {
		setHasBeenNotified(true);
		onClose();
	};

	const handleGoToConsole = () => {
		setHasBeenNotified(true);
		onGoToConsole();
	};

	return (
		<BaseDialog
			open={open}
			onClose={handleClose}
			title={
				<>
					<img src={RadientIcon} alt="Radient icon" className="size-7" />
					Running low on Radient credits?
				</>
			}
			maxWidth="sm"
			fullWidth={false}
			actions={
				<>
					<SecondaryButton onClick={handleClose}>Maybe later</SecondaryButton>
					<PrimaryButton
						onClick={handleGoToConsole}
						startIcon={<ExternalLink size={18} />}
						className="min-w-55"
					>
						Get more credits
					</PrimaryButton>
				</>
			}
		>
			<div className="flex flex-col items-center gap-4 py-2 text-center">
				<img src={RadientIcon} alt="Radient logo" className="size-30" />
				<p className="text-body-sm text-ink-muted">
					Unlock the full power of Local Operator with{" "}
					<span className="font-bold text-accent">Radient Pass</span>!
				</p>
				<p className="text-body-sm text-ink-muted">
					Using Local Operator with{" "}
					<span className="font-bold text-accent">Radient Automatic</span> is
					often <span className="font-bold text-accent">cheaper</span> than
					bringing your own key. Radient's smart model routing picks the most
					cost-effective and powerful model for each step of your agentic
					workflows.
				</p>
				<p className="text-body-sm text-ink-muted">
					It's <span className="font-bold text-accent">pay-as-you-go</span> with
					no commitments. Load up what you need, starting small for maximum
					flexibility.
				</p>

				<p className="text-body-sm text-ink-muted">
					Plus, get{" "}
					<span className="font-medium text-accent">
						{isLoadingPrices ? (
							<Spinner size="sm" className="mr-0.5 align-middle" />
						) : (
							formatCurrency(prices?.default_registration_credits)
						)}
					</span>{" "}
					in bonus credits with your first purchase.
					{pricesError && (
						<span className="mt-1 block text-meta text-danger">
							Could not load bonus credit information.
						</span>
					)}
				</p>

				<div className="mt-3 mb-1">
					<Button asChild variant="primary" size="lg" className="min-w-55">
						<a
							href="https://console.radienthq.com"
							target="_blank"
							rel="noopener noreferrer"
						>
							<ExternalLink aria-hidden="true" />
							Visit Radient Console
						</a>
					</Button>
				</div>
				<p className="text-meta text-ink-dim">
					You can also access the Radient Console from the{" "}
					<span className="font-bold text-accent">Settings</span> page anytime.
				</p>
			</div>
		</BaseDialog>
	);
};
