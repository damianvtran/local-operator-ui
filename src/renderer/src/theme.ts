import { createTheme } from '@mui/material/styles';
import type React from 'react';
declare module '@mui/material/styles' {
	interface Palette {
		caption: string;
	}
	interface PaletteOptions {
		caption?: string;
	}
	interface TypographyVariants {
		gradientTitle: React.CSSProperties;
	}
	interface TypographyVariantsOptions {
		gradientTitle?: React.CSSProperties;
	}
}

// Extend the Typography props so that "gradientTitle" can be used as a variant
declare module '@mui/material/Typography' {
	interface TypographyPropsVariantOverrides {
		gradientTitle: true;
	}
}

// Extend the Button props so that "nav" can be used as a variant
declare module '@mui/material/Button' {
	interface ButtonPropsVariantOverrides {
		nav: true;
	}
}

const theme = createTheme({
	breakpoints: {
		values: {
			xs: 0,
			sm: 600,
			md: 900,
			lg: 1300,
			xl: 1800,
		},
	},
	palette: {
		mode: 'dark',
		primary: {
			main: '#38C96A',
			dark: '#16B34A',
			light: '#68D88E',
			contrastText: '#ffffff',
		},
		secondary: {
			main: '#26BC85',
			dark: '#0AA26D',
			light: '#52CF9D',
			contrastText: '#ffffff',
		},
		background: {
			default: '#0A0A0A',
			paper: '#141414',
		},
		text: {
			primary: '#F9FAFB',
			secondary: '#9CA3AF',
		},
		caption: 'rgba(255, 255, 255, 0.8)',
	},
	typography: {
		fontFamily: 'system-ui, Inter, -apple-system, BlinkMacSystemFont, sans-serif',
		fontSize: 16,
		h1: { fontWeight: 600 },
		h2: { fontWeight: 600 },
		h3: { 
			fontWeight: 600, 
			fontSize: '3rem',
			'@media (max-width:600px)': {
				fontSize: '2.7rem',
			},
		},
		gradientTitle: {
			fontSize: '1.4rem',
			fontWeight: 400,
			letterSpacing: '0.02em',
			background: 'linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85))',
			WebkitBackgroundClip: 'text',
			WebkitTextFillColor: 'transparent',
			textShadow: '0 0 30px rgba(255,255,255,0.1)',
		},
	},
	components: {
		MuiAppBar: {
			styleOverrides: {
				root: {
					top: 0,
					background: 'rgba(10,10,10,0.8)',
					backdropFilter: 'blur(10px)',
				},
			},
		},
		MuiListItemButton: {
			styleOverrides: {
				root: {
					borderRadius: 12, // roughly 1.5 spacing units assuming an 8px baseline
					transition: 'all 0.2s ease-in-out',
					paddingTop: 12,
					paddingBottom: 12,
					'&:hover': {
						background: 'rgba(255,255,255,0.05)',
						backdropFilter: 'blur(4px)',
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: 'rgba(255,255,255,0.85)',
					marginRight: 8,
					'&:hover': {
						background: 'rgba(255,255,255,0.05)',
					},
				},
			},
		},
		MuiButton: {
			variants: [
				{
					props: { variant: 'nav' },
					style: {
						color: 'rgba(255,255,255,0.85)',
						margin: '0 4px',
						padding: '8px 16px',
						borderRadius: 12,
						transition: 'all 0.2s ease-in-out',
						'&:hover': {
							background: 'rgba(255,255,255,0.05)',
							backdropFilter: 'blur(4px)',
						},
					},
				},
			],
			styleOverrides: {
				root: {
					textTransform: 'none',
					borderRadius: 6,
					fontWeight: 500,
					padding: '8px 16px',
				},
				contained: {
					boxShadow: 'none',
					'&:hover': {
						boxShadow: 'none',
					},
				},
			},
		},
		MuiCard: {
			styleOverrides: {
				root: {
					backgroundColor: '#141414',
					borderRadius: 12,
					border: '1px solid rgba(255, 255, 255, 0.1)',
					backdropFilter: 'blur(8px)',
				},
			},
		},
		MuiContainer: {
			styleOverrides: {
				maxWidthLg: {
					maxWidth: '1300px',
					'@media (min-width:1300px)': {
						maxWidth: '1300px',
					},
				},
				maxWidthXl: {
					maxWidth: '1800px',
					'@media (min-width:1800px)': {
						maxWidth: '1800px',
					},
				},
			},
		},
	},
});

export default theme;