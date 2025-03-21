import {
	faLeaf,
	faMoon,
	faSkull,
	faSun,
} from "@fortawesome/free-solid-svg-icons";
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
const DarkPreview = styled(Box)(() => {
	// Use the actual dark theme colors from the theme
	const darkTheme = themes.localOperatorDark.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${darkTheme.palette.sidebar.background} 0%, ${darkTheme.palette.sidebar.background} 30%, ${darkTheme.palette.background.paper} 30%, ${darkTheme.palette.background.paper} 100%)`,
		position: "relative",
		boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
		borderRadius: 4,
		"&::after": {
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			width: "40%",
			height: "20%",
			backgroundColor: darkTheme.palette.primary.main,
			borderRadius: 4,
		},
		// Add a sidebar-like element
		"&::before": {
			content: '""',
			position: "absolute",
			left: 0,
			top: 0,
			height: "100%",
			width: "20%",
			backgroundColor: darkTheme.palette.sidebar.background,
			borderRight: `1px solid ${darkTheme.palette.sidebar.border}`,
		},
	};
});

// Light theme preview
const LightPreview = styled(Box)(() => {
	// Use the actual light theme colors from the theme
	const lightTheme = themes.localOperatorLight.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${lightTheme.palette.sidebar.background} 0%, ${lightTheme.palette.sidebar.background} 30%, ${lightTheme.palette.background.paper} 30%, ${lightTheme.palette.background.paper} 100%)`,
		position: "relative",
		boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
		borderRadius: 4,
		"&::after": {
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			width: "40%",
			height: "20%",
			backgroundColor: lightTheme.palette.primary.main,
			borderRadius: 4,
		},
		// Add a sidebar-like element
		"&::before": {
			content: '""',
			position: "absolute",
			left: 0,
			top: 0,
			height: "100%",
			width: "20%",
			backgroundColor: lightTheme.palette.sidebar.background,
			borderRight: `1px solid ${lightTheme.palette.sidebar.border}`,
		},
	};
});

// Dracula theme preview
const DraculaPreview = styled(Box)(() => {
	// Use the actual dracula theme colors from the theme
	const draculaTheme = themes.dracula.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${draculaTheme.palette.sidebar.background} 0%, ${draculaTheme.palette.sidebar.background} 30%, ${draculaTheme.palette.background.paper} 30%, ${draculaTheme.palette.background.paper} 100%)`,
		position: "relative",
		boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
		borderRadius: 4,
		"&::after": {
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			width: "40%",
			height: "20%",
			backgroundColor: draculaTheme.palette.primary.main,
			borderRadius: 4,
		},
		// Add a sidebar-like element
		"&::before": {
			content: '""',
			position: "absolute",
			left: 0,
			top: 0,
			height: "100%",
			width: "20%",
			backgroundColor: draculaTheme.palette.sidebar.background,
			borderRight: `1px solid ${draculaTheme.palette.sidebar.border}`,
		},
	};
});

// Sage theme preview
const SagePreview = styled(Box)(() => {
	// Use the actual sage theme colors from the theme
	const sageTheme = themes.sage.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${sageTheme.palette.sidebar.background} 0%, ${sageTheme.palette.sidebar.background} 30%, ${sageTheme.palette.background.paper} 30%, ${sageTheme.palette.background.paper} 100%)`,
		position: "relative",
		boxShadow: "0 2px 8px rgba(46, 61, 28, 0.1)",
		borderRadius: 4,
		"&::after": {
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			width: "40%",
			height: "20%",
			backgroundColor: sageTheme.palette.primary.main,
			borderRadius: 4,
		},
		// Add a sidebar-like element
		"&::before": {
			content: '""',
			position: "absolute",
			left: 0,
			top: 0,
			height: "100%",
			width: "20%",
			backgroundColor: sageTheme.palette.sidebar.background,
			borderRight: `1px solid ${sageTheme.palette.sidebar.border}`,
		},
	};
});

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

					{/* Dracula Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "dracula"}
							onClick={() => handleThemeChange("dracula")}
						>
							<ThemePreview>
								<DraculaPreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faSkull} />
								<Typography
									variant="body2"
									fontWeight={themeName === "dracula" ? "bold" : "normal"}
								>
									{themes.dracula.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>

					{/* Sage Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "sage"}
							onClick={() => handleThemeChange("sage")}
						>
							<ThemePreview>
								<SagePreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faLeaf} />
								<Typography
									variant="body2"
									fontWeight={themeName === "sage" ? "bold" : "normal"}
								>
									{themes.sage.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>
				</Grid>
			</StyledCardContent>
		</Card>
	);
};
