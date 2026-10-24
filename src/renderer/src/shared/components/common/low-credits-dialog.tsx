import RadientIcon from "@renderer/assets/radient-icon-1024x1024.png";
import { Spinner } from "@shared/components/common/spinner";
import { useRadientPricesQuery } from "@shared/hooks/use-radient-prices-query";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useLowCreditsStore } from "@shared/store/low-credits-store";
import { ExternalLink } from "lucide-react";
import type { FC } from "react";
import { t } from "../../../../../i18n/messages";
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
	useI18nLocale();
	const { setHasBeenNotified } = useLowCreditsStore();
	const {
		prices,
		isLoading: isLoadingPrices,
		error: pricesError,
	} = useRadientPricesQuery();

	const formatCurrency = (amount: number | undefined) => {
		if (typeof amount !== "number") return "$..."; // Fallback for loading/error
		return t("ui.common.account.low_credits_dialog.detail", {
			detail: String(amount.toFixed(2)),
		}); // Basic USD formatting
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
					<img
						src={RadientIcon}
						alt={t("ui.common.account.low_credits_dialog.radient_icon")}
						className="size-7"
					/>
					{t(
						"ui.common.account.low_credits_dialog.running_low_on_radient_credits",
					)}
				</>
			}
			maxWidth="sm"
			fullWidth={false}
			actions={
				<>
					<SecondaryButton onClick={handleClose}>
						{t("ui.common.account.low_credits_dialog.maybe_later")}
					</SecondaryButton>
					<PrimaryButton
						onClick={handleGoToConsole}
						startIcon={<ExternalLink size={18} />}
						className="min-w-55"
					>
						{t("ui.common.account.low_credits_dialog.get_more_credits")}
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
			{/* No second logo. The same asset renders at `size-7` in the title
			    40px above, so the hexagon appeared twice in one 574px panel
			    under two different alt texts - one graphic announced to a screen
			    reader as two. Its 120px also pushed the closing line under the
			    footer at 800x600, which is exactly this app's minimum window. */}
			<div className="flex flex-col items-center gap-4 py-2 text-center">
				<p className="text-body-sm text-ink-muted">
					{t(
						"ui.common.account.low_credits_dialog.unlock_the_full_power_of_local_operator_with",
					)}{" "}
					<span className="font-bold text-accent">
						{t("ui.common.account.low_credits_dialog.radient_pass")}
					</span>
					.
				</p>
				<p className="text-body-sm text-ink-muted">
					{t(
						"ui.common.account.low_credits_dialog.radient_automatic_is_often_cheaper_than_bringing_your_own_key_its",
					)}
				</p>
				<p className="text-body-sm text-ink-muted">
					{t(
						"ui.common.account.low_credits_dialog.it_s_pay_as_you_go_with_no_commitments_load_up_what_you_need_star",
					)}
				</p>

				<p className="text-body-sm text-ink-muted">
					{t("ui.common.account.low_credits_dialog.plus_get")}{" "}
					<span className="font-medium text-ink">
						{isLoadingPrices ? (
							<Spinner size="sm" className="me-0.5 align-middle" />
						) : (
							formatCurrency(prices?.default_registration_credits)
						)}
					</span>{" "}
					{t(
						"ui.common.account.low_credits_dialog.in_bonus_credits_with_your_first_purchase",
					)}
					{pricesError && (
						<span className="mt-1 block text-meta text-danger">
							{t(
								"ui.common.account.low_credits_dialog.could_not_load_bonus_credit_information",
							)}
						</span>
					)}
				</p>

				<p className="text-meta text-ink-dim">
					{t(
						"ui.common.account.low_credits_dialog.you_can_also_reach_the_radient_console_from_settings_at_any_time",
					)}
				</p>
			</div>
		</BaseDialog>
	);
};
