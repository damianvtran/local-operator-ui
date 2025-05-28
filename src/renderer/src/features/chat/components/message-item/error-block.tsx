import { Box, Link as MuiLink, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { Info } from "lucide-react";
import type { FC } from "react";
import { Link } from "react-router-dom";
/**
 * Props for the ErrorBlock component
 */
export type ErrorBlockProps = {
	error: string;
	isUser: boolean;
};

const CodeContainer = styled(Box)({
	marginBottom: 16,
	width: "100%",
});

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	marginBottom: 4,
	color: theme.palette.error.light,
}));

const ErrorContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<{ isUser: boolean }>(({ isUser, theme }) => ({
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.85rem",
	backgroundColor: alpha(
		theme.palette.error.main,
		theme.palette.mode === "dark" ? 0.1 : 0.05,
	),
	borderRadius: "8px",
	padding: 12,
	maxHeight: "200px",
	overflow: "auto",
	display: "flex",
	flexDirection: "column-reverse",
	whiteSpace: "pre-wrap",
	color: isUser ? theme.palette.error.main : theme.palette.error.light,
	width: "100%",
	boxShadow: `0 2px 6px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.15 : 0.1)}`,
	"&::-webkit-scrollbar": {
		width: "6px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.common.black,
			0.1,
		),
		borderRadius: "3px",
	},
}));

const InfoContainer = styled(Box)(({ theme }) => ({
	fontFamily: theme.typography.fontFamily,
	fontSize: "0.875rem",
	backgroundColor: theme.palette.background.paper,
	borderRadius: "8px",
	padding: "12px",
	marginTop: "12px",
	display: "flex",
	alignItems: "center",
	gap: "8px",
	color: theme.palette.text.primary,
	width: "100%",
	border: `1px solid ${theme.palette.divider}`,
}));

const InfoText = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem",
	color: theme.palette.text.primary,
}));

const errorSuggestions: Record<string, React.ReactNode> = {
	"Hosting platform is not configured": (
		<InfoText>
			You haven't selected an AI provider yet. Please go to the{" "}
			<MuiLink component={Link} to="/settings" color="inherit">
				settings page
			</MuiLink>{" "}
			to configure it for all your agents. If you don't have an AI provider, you
			can sign in to Radient to get access for free to start!
		</InfoText>
	),
	"Model name is not configured": (
		<InfoText>
			You haven't selected an AI model yet. Please go to the{" "}
			<MuiLink component={Link} to="/settings" color="inherit">
				settings page
			</MuiLink>{" "}
			to select a model for all your agents. If you don't have an AI provider,
			you can sign in to Radient to get access for free to start!
		</InfoText>
	),
	"Rate limit": (
		<InfoText>
			You've hit the rate limit for your AI provider. Please try again later or
			get Radient Pass in the{" "}
			<MuiLink component={Link} to="/settings" color="inherit">
				settings page
			</MuiLink>{" "}
			to access AI models with no rate limits at low prices.
		</InfoText>
	),
	"Rate-limit": (
		<InfoText>
			You've hit the rate limit for your AI provider. Please try again later or
			get Radient Pass in the{" "}
			<MuiLink component={Link} to="/settings" color="inherit">
				settings page
			</MuiLink>{" "}
			to access all AI models with no rate limits at low prices.
		</InfoText>
	),
	"Invalid API key": (
		<InfoText>
			Your API key is invalid. Please go to the{" "}
			<MuiLink component={Link} to="/settings" color="inherit">
				settings page
			</MuiLink>{" "}
			to update your API key.
		</InfoText>
	),
	"404 models": (
		<InfoText>
			No models found. Please go to the{" "}
			<MuiLink component={Link} to="/settings" color="inherit">
				settings page
			</MuiLink>{" "}
			to select a different model, or try using Radient to get access to
			hundreds of models with no rate limits
		</InfoText>
	),
	"Call ListModels": (
		<InfoText>
			No models found. Please go to the{" "}
			<MuiLink component={Link} to="/settings" color="inherit">
				settings page
			</MuiLink>{" "}
			to select a different model, or try using Radient to get access to
			hundreds of models with no rate limits
		</InfoText>
	),
};

/**
 * Component for displaying error messages
 */
export const ErrorBlock: FC<ErrorBlockProps> = ({ error, isUser }) => {
	if (!error || error === "[No error output]") return null;

	const trimmedError = error.trim();
	let suggestion: React.ReactNode | undefined;

	const lowercasedTrimmedError = trimmedError.toLowerCase();
	for (const key in errorSuggestions) {
		if (lowercasedTrimmedError.includes(key.toLowerCase())) {
			suggestion = errorSuggestions[key];
			break;
		}
	}

	return (
		<CodeContainer>
			<SectionLabel variant="caption">Error</SectionLabel>
			<ErrorContainer isUser={isUser}>{error}</ErrorContainer>
			{suggestion && (
				<InfoContainer>
					<Box
						sx={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: "24px",
							height: "24px",
						}}
					>
						<Info size={18} />
					</Box>
					{suggestion}
				</InfoContainer>
			)}
		</CodeContainer>
	);
};
