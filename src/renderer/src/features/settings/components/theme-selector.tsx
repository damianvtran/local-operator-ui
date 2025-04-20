import {
	faCode,
	faFire,
	faHexagonNodes,
	faIcicles,
	faLeaf,
	faMoon,
	faMountain,
	faSkull,
	faSun,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Card, CardContent, Grid, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { themes } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
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

// Monokai theme preview
const MonokaiPreview = styled(Box)(() => {
	// Use the actual monokai theme colors from the theme
	const monokaiTheme = themes.monokai.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${monokaiTheme.palette.sidebar.background} 0%, ${monokaiTheme.palette.sidebar.background} 30%, ${monokaiTheme.palette.background.paper} 30%, ${monokaiTheme.palette.background.paper} 100%)`,
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
			backgroundColor: monokaiTheme.palette.primary.main,
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
			backgroundColor: monokaiTheme.palette.sidebar.background,
			borderRight: `1px solid ${monokaiTheme.palette.sidebar.border}`,
		},
	};
});

// Tokyo Night theme preview
const TokyoNightPreview = styled(Box)(() => {
	// Use the actual Tokyo Night theme colors from the theme
	const tokyoNightTheme = themes.tokyoNight.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${tokyoNightTheme.palette.sidebar.background} 0%, ${tokyoNightTheme.palette.sidebar.background} 30%, ${tokyoNightTheme.palette.background.paper} 30%, ${tokyoNightTheme.palette.background.paper} 100%)`,
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
			backgroundColor: tokyoNightTheme.palette.primary.main,
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
			backgroundColor: tokyoNightTheme.palette.sidebar.background,
			borderRight: `1px solid ${tokyoNightTheme.palette.sidebar.border}`,
		},
	};
});

// Dune theme preview
const DunePreview = styled(Box)(() => {
	// Use the actual Dune theme colors from the theme
	const duneTheme = themes.dune.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${duneTheme.palette.sidebar.background} 0%, ${duneTheme.palette.sidebar.background} 30%, ${duneTheme.palette.background.paper} 30%, ${duneTheme.palette.background.paper} 100%)`,
		position: "relative",
		boxShadow: "0 2px 8px rgba(255, 140, 56, 0.2)",
		borderRadius: 4,
		"&::after": {
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			width: "40%",
			height: "20%",
			backgroundColor: duneTheme.palette.primary.main,
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
			backgroundColor: duneTheme.palette.sidebar.background,
			borderRight: `1px solid ${duneTheme.palette.sidebar.border}`,
		},
	};
});

// Iceberg theme preview
const IcebergPreview = styled(Box)(() => {
	// Use the actual Iceberg theme colors from the theme
	const icebergTheme = themes.iceberg.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${icebergTheme.palette.sidebar.background} 0%, ${icebergTheme.palette.sidebar.background} 30%, ${icebergTheme.palette.background.paper} 30%, ${icebergTheme.palette.background.paper} 100%)`,
		position: "relative",
		boxShadow: "0 2px 8px rgba(45, 83, 158, 0.1)",
		borderRadius: 4,
		"&::after": {
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			width: "40%",
			height: "20%",
			backgroundColor: icebergTheme.palette.primary.main,
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
			backgroundColor: icebergTheme.palette.sidebar.background,
			borderRight: `1px solid ${icebergTheme.palette.sidebar.border}`,
		},
	};
});

// Radient theme preview
const RadientPreview = styled(Box)(() => {
	// Use the actual Radient theme colors from the theme
	const radientTheme = themes.radient.theme;

	return {
		width: "100%",
		height: "100%",
		background: `linear-gradient(to bottom, ${radientTheme.palette.sidebar.background} 0%, ${radientTheme.palette.sidebar.background} 30%, ${radientTheme.palette.background.paper} 30%, ${radientTheme.palette.background.paper} 100%)`,
		position: "relative",
		boxShadow: "0 2px 8px rgba(255, 100, 200, 0.2)",
		borderRadius: 4,
		"&::after": {
			content: '""',
			position: "absolute",
			top: "50%",
			left: "50%",
			transform: "translate(-50%, -50%)",
			width: "40%",
			height: "20%",
			backgroundColor: radientTheme.palette.primary.main,
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
			backgroundColor: radientTheme.palette.sidebar.background,
			borderRight: `1px solid ${radientTheme.palette.sidebar.border}`,
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

					{/* Radient Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "radient"}
							onClick={() => handleThemeChange("radient")}
						>
							<ThemePreview>
								<RadientPreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faHexagonNodes} />
								<Typography
									variant="body2"
									fontWeight={themeName === "radient" ? "bold" : "normal"}
								>
									{themes.radient.name}
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

					{/* Monokai Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "monokai"}
							onClick={() => handleThemeChange("monokai")}
						>
							<ThemePreview>
								<MonokaiPreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faCode} />
								<Typography
									variant="body2"
									fontWeight={themeName === "monokai" ? "bold" : "normal"}
								>
									{themes.monokai.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>

					{/* Tokyo Night Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "tokyoNight"}
							onClick={() => handleThemeChange("tokyoNight")}
						>
							<ThemePreview>
								<TokyoNightPreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faMountain} />
								<Typography
									variant="body2"
									fontWeight={themeName === "tokyoNight" ? "bold" : "normal"}
								>
									{themes.tokyoNight.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>

					{/* Dune Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "dune"}
							onClick={() => handleThemeChange("dune")}
						>
							<ThemePreview>
								<DunePreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faFire} />
								<Typography
									variant="body2"
									fontWeight={themeName === "dune" ? "bold" : "normal"}
								>
									{themes.dune.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>

					{/* Iceberg Theme Option */}
					<Grid item xs={12} sm={6} md={4} lg={3}>
						<ThemeOption
							isSelected={themeName === "iceberg"}
							onClick={() => handleThemeChange("iceberg")}
						>
							<ThemePreview>
								<IcebergPreview />
							</ThemePreview>
							<ThemeLabel>
								<FontAwesomeIcon icon={faIcicles} />
								<Typography
									variant="body2"
									fontWeight={themeName === "iceberg" ? "bold" : "normal"}
								>
									{themes.iceberg.name}
								</Typography>
							</ThemeLabel>
						</ThemeOption>
					</Grid>
				</Grid>
			</StyledCardContent>
		</Card>
	);
};
