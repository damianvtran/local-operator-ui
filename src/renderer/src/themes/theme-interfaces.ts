import type React from "react";

/**
 * Theme interface declarations for Material-UI
 *
 * This file centralizes all theme interface extensions to avoid redundancy
 * across individual theme files.
 */

declare module "@mui/material/styles" {
	interface Palette {
		caption: string;
		sidebar: {
			background: string;
			border: string;
			itemHover: string;
			itemActive: string;
			itemActiveHover: string;
			itemText: string;
			itemActiveText: string;
			toggleButton: {
				background: string;
				border: string;
				hoverBackground: string;
				hoverBorder: string;
			};
		};
		tooltip: {
			background: string;
			border: string;
			text: string;
		};
		userMessage: {
			background: string;
			border: string;
			shadow: string;
		};
		actionHighlight: {
			done: {
				background: string;
				border: string;
			};
			ask: {
				background: string;
				border: string;
			};
		};
	}
	interface PaletteOptions {
		caption?: string;
		sidebar?: {
			background?: string;
			border?: string;
			itemHover?: string;
			itemActive?: string;
			itemActiveHover?: string;
			itemText?: string;
			itemActiveText?: string;
			toggleButton?: {
				background?: string;
				border?: string;
				hoverBackground?: string;
				hoverBorder?: string;
			};
		};
		tooltip?: {
			background?: string;
			border?: string;
			text?: string;
		};
		userMessage?: {
			background?: string;
			border?: string;
			shadow?: string;
		};
		actionHighlight?: {
			done?: {
				background?: string;
				border?: string;
			};
			ask?: {
				background?: string;
				border?: string;
			};
		};
	}
	interface TypographyVariants {
		gradientTitle: React.CSSProperties;
	}
	interface TypographyVariantsOptions {
		gradientTitle?: React.CSSProperties;
	}
}

// Extend the Typography props so that "gradientTitle" can be used as a variant
declare module "@mui/material/Typography" {
	interface TypographyPropsVariantOverrides {
		gradientTitle: true;
	}
}

// Extend the Button props so that "nav" can be used as a variant
declare module "@mui/material/Button" {
	interface ButtonPropsVariantOverrides {
		nav: true;
	}
}
