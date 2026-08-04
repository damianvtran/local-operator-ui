import type React from "react";
import type { ThemePalette } from "./palette-contract";

/**
 * Theme interface declarations for Material-UI.
 *
 * Centralised so the augmentations are declared once rather than in every
 * theme file, which is how they used to drift.
 */

declare module "@mui/material/styles" {
	interface Palette {
		/**
		 * The palette this theme was built from, verbatim.
		 *
		 * The MUI keys below are a projection: they cover what MUI itself needs
		 * and what the ~1405 existing `theme.palette.*` call sites already read,
		 * but MUI has no key for `elevated`, `sunken`, `inkDim`, `borderControl`
		 * or any of the twelve wash/border values. Rather than invent a MUI key
		 * for each, the roles are carried through intact so a consumer that needs
		 * one can reach it without a second source of truth appearing.
		 *
		 * Reach for a MUI key first; use this when the role has no MUI analogue.
		 */
		roles: ThemePalette;
		caption: string;
		sidebar: {
			background: string;
			secondaryBackground: string;
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
		icon: {
			background: string;
			text: string;
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
		messagesView: {
			background: string;
		};
		inputField: {
			background: string;
			hoverBackground: string;
			focusBackground: string;
			border: string;
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
		roles?: ThemePalette;
		caption?: string;
		sidebar?: {
			background?: string;
			secondaryBackground?: string;
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
		icon?: {
			background?: string;
			text?: string;
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
		messagesView?: {
			background?: string;
		};
		inputField?: {
			background?: string;
			hoverBackground?: string;
			focusBackground?: string;
			border?: string;
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
