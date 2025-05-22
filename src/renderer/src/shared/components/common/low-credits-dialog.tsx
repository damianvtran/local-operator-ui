import {
	Box,
	CircularProgress,
	Link,
	Typography,
	alpha,
	styled,
	useTheme,
} from "@mui/material";
import RadientIcon from "@renderer/assets/radient-icon-1024x1024.png";
import { useRadientPricesQuery } from "@shared/hooks/use-radient-prices-query"; // Import useRadientPricesQuery
import { useLowCreditsStore } from "@shared/store/low-credits-store";
import { ExternalLink } from "lucide-react";
import type { FC } from "react";
import { BaseDialog, PrimaryButton, SecondaryButton } from "./base-dialog";

const IconImage = styled("img")({
	width: 80,
	height: 80,
	marginBottom: "16px",
});

const DialogContentWrapper = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	textAlign: "center",
	padding: theme.spacing(2, 0), // Add some vertical padding
}));

const MarketingText = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(2),
	color: theme.palette.text.secondary,
	fontSize: "0.9rem",
	maxWidth: "90%", // Ensure text doesn't get too wide
}));

const HighlightText = styled("span")(({ theme }) => ({
	color: theme.palette.primary.main,
	fontWeight: "bold",
}));

const CTAButton = styled(PrimaryButton)(({ theme }) => ({
	marginBottom: theme.spacing(1.5),
	minWidth: 220, // Make button wider
	boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.3)}`, // Add more prominent shadow
}));

const SettingsLinkText = styled(Typography)(({ theme }) => ({
	fontSize: "0.8rem",
	color: theme.palette.text.disabled,
}));

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
	const theme = useTheme();
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
				<Box display="flex" alignItems="center" gap={1.5}>
					<img
						src={RadientIcon}
						alt="Radient Icon"
						style={{ width: 28, height: 28 }}
					/>
					<Typography variant="h6" fontWeight={600}>
						Running Low on Radient Credits?
					</Typography>
				</Box>
			}
			maxWidth="sm"
			fullWidth={false}
			actions={
				<>
					<SecondaryButton onClick={handleClose}>Maybe Later</SecondaryButton>
					<CTAButton
						onClick={handleGoToConsole}
						startIcon={<ExternalLink size={18} />}
						sx={{
							marginBottom: 0,
						}}
					>
						Get More Credits
					</CTAButton>
				</>
			}
		>
			<DialogContentWrapper>
				<IconImage
					src={RadientIcon}
					alt="Radient Logo"
					sx={{
						width: 120,
						height: 120,
					}}
				/>
				<MarketingText variant="body1" sx={{ mb: 1 }}>
					Unlock the full power of Local Operator with{" "}
					<HighlightText>Radient Pass</HighlightText>!
				</MarketingText>
				<MarketingText variant="body2">
					Using Local Operator with{" "}
					<HighlightText>Radient Automatic</HighlightText> is often{" "}
					<HighlightText>cheaper</HighlightText> than bringing your own key.
					Radient's smart model routing picks the most cost-effective and
					powerful model for each step of your agentic workflows.
				</MarketingText>
				<MarketingText variant="body2" sx={{ mt: 1 }}>
					It's <HighlightText>pay-as-you-go</HighlightText> with no commitments.
					Load up what you need, starting small for maximum flexibility.
				</MarketingText>

				<MarketingText variant="body2" sx={{ mt: 2, mb: 2 }}>
					Plus, get{" "}
					<Typography
						component="span"
						fontWeight="medium"
						color={theme.palette.primary.main}
						sx={{ fontSize: "inherit" }}
					>
						{isLoadingPrices ? (
							<CircularProgress
								size={14}
								sx={{ mr: 0.5, verticalAlign: "middle" }}
							/>
						) : (
							formatCurrency(prices?.default_registration_credits)
						)}
					</Typography>{" "}
					in bonus credits with your first purchase!
					{pricesError && (
						<Typography
							color="error"
							variant="caption"
							display="block"
							mt={0.5}
						>
							Could not load bonus credit information.
						</Typography>
					)}
				</MarketingText>

				<Box mt={3} mb={1}>
					<Link
						href="https://console.radienthq.com"
						target="_blank"
						rel="noopener noreferrer"
						sx={{ textDecoration: "none" }}
					>
						<CTAButton startIcon={<ExternalLink size={18} />}>
							Visit Radient Console
						</CTAButton>
					</Link>
				</Box>
				<SettingsLinkText>
					You can also access the Radient Console from the{" "}
					<HighlightText>Settings</HighlightText> page anytime.
				</SettingsLinkText>
			</DialogContentWrapper>
		</BaseDialog>
	);
};
