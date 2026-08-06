import RadientIcon from "@renderer/assets/radient-icon-1024x1024.png";
import { Spinner } from "@shared/components/common/spinner";
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
			{/*
			 * One accent-filled call to action, in the footer.
			 *
			 * There were two to the same URL about 100px apart, and the in-body
			 * one neither closed the dialog nor recorded that the user had been
			 * told - so taking it sent them to the browser and left the nag
			 * armed to fire again. The body also spent bold accent on five
			 * phrases, which with the two buttons and the logo put eight accent
			 * marks on one screen against the three the branding doc allows.
			 * Emphasis everywhere is emphasis nowhere, and here it was competing
			 * with the only control that does anything.
			 */}
			<div className="flex flex-col items-center gap-4 py-2 text-center">
				<img src={RadientIcon} alt="Radient logo" className="size-30" />
				<p className="text-body-sm text-ink-muted">
					Unlock the full power of Local Operator with{" "}
					<span className="font-bold text-accent">Radient Pass</span>.
				</p>
				<p className="text-body-sm text-ink-muted">
					Radient Automatic is often cheaper than bringing your own key: its
					smart model routing picks the most cost-effective model for each step
					of your agentic workflows.
				</p>
				<p className="text-body-sm text-ink-muted">
					It's pay-as-you-go with no commitments. Load up what you need,
					starting small for maximum flexibility.
				</p>

				<p className="text-body-sm text-ink-muted">
					Plus, get{" "}
					<span className="font-medium text-ink">
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

				<p className="text-meta text-ink-dim">
					You can also reach the Radient Console from Settings at any time.
				</p>
			</div>
		</BaseDialog>
	);
};
