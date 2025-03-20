import { faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Card, CardContent, Grid, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useUiPreferencesStore } from "@renderer/store/ui-preferences-store";
import { themes } from "@renderer/themes";
import type { ThemeName } from "@renderer/themes";
import type { FC } from "react";

const StyledCardContent = styled(CardContent)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		padding: 16,
	},
	[theme.breakpoints.up("sm")]: {
		padding: 24,
	},
}));

const ThemePreview = styled(Box)(({ theme }) => ({
	width: "100%",
	height: 120,
	borderRadius: 8,
	overflow: "hidden",
	marginBottom: 8,
	border: `1px solid ${theme.palette.divider}`,
}));

const ThemeOption = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isSelected",
})<{ isSelected?: boolean }>(({ theme, isSelected }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	width: "100%",
	cursor: "pointer",
	borderRadius: 8,
	padding: 8,
	transition: "all 0.2s ease",
	border: isSelected
		? `2px solid ${theme.palette.primary.main}`
		: "2px solid transparent",
	borderBottom: isSelected
		? `4px solid ${theme.palette.primary.main}`
		: "4px solid transparent",
	backgroundColor: isSelected ? theme.palette.action.selected : "transparent",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
}));

const ThemeLabel = styled(Box)(() => ({
	display: "flex",
	alignItems: "center",
	gap: 8,
	marginTop: 4,
}));

// Dark theme preview
const DarkPreview = styled(Box)(() => ({
	width: "100%",
	height: "100%",
	background:
		"linear-gradient(to bottom, #0A0A0A 0%, #0A0A0A 30%, #141414 30%, #141414 100%)",
	position: "relative",
	"&::after": {
		content: '""',
		position: "absolute",
		top: "50%",
		left: "50%",
		transform: "translate(-50%, -50%)",
		width: "40%",
		height: "20%",
		backgroundColor: "#38C96A",
		borderRadius: 4,
	},
}));

// Light theme preview
const LightPreview = styled(Box)(() => ({
	width: "100%",
	height: "100%",
	background:
		"linear-gradient(to bottom, #F9FAFB 0%, #F9FAFB 30%, #FFFFFF 30%, #FFFFFF 100%)",
	position: "relative",
	"&::after": {
		content: '""',
		position: "absolute",
		top: "50%",
		left: "50%",
		transform: "translate(-50%, -50%)",
		width: "40%",
		height: "20%",
		backgroundColor: "#38C96A",
		borderRadius: 4,
	},
}));

/**
 * Theme selector component
 *
 * Allows the user to select a theme for the application
 */
export const ThemeSelector: FC = () => {
	const { themeName, setTheme } = useUiPreferencesStore();

	const handleThemeChange = (newTheme: ThemeName) => {
		setTheme(newTheme);
	};

	return (
		<Card>
			<StyledCardContent>
				<Grid container spacing={2} sx={{ mt: 1 }}>
					{/* Dark Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "localOperatorDark"}
							onClick={() => handleThemeChange("localOperatorDark")}
						>
							<ThemePreview>
								<DarkPreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faMoon} />
								<Typography
									variant="body2"
									fontWeight={
										themeName === "localOperatorDark" ? "bold" : "normal"
									}
								>
									{themes.localOperatorDark.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>

					{/* Light Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "localOperatorLight"}
							onClick={() => handleThemeChange("localOperatorLight")}
						>
							<ThemePreview>
								<LightPreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faSun} />
								<Typography
									variant="body2"
									fontWeight={
										themeName === "localOperatorLight" ? "bold" : "normal"
									}
								>
									{themes.localOperatorLight.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>
				</Grid>
			</StyledCardContent>
		</Card>
	);
};
