import type { CSSProperties } from "react";

const THEME_ROLES = {
	"--pele-bg": "--color-surface",
	"--pele-fg": "--color-ink",
	"--pele-muted": "--color-ink-muted",
	"--pele-line": "--color-ink-muted",
	"--pele-surface": "--color-elevated",
	"--pele-surface-alt": "--color-sunken",
	"--pele-border": "--color-control",
	"--pele-accent": "--color-accent",
	"--pele-critical": "--color-danger",
	"--pele-error": "--color-danger",
	"--pele-series-1": "--color-accent",
	"--pele-series-2": "--color-accent-alt",
	"--pele-series-3": "--color-warning",
	"--pele-series-4": "--color-danger",
	"--pele-series-5": "--color-info",
	"--pele-series-6": "--color-success",
	"--pele-series-7": "--color-accent",
	"--pele-series-8": "--color-accent-alt",
} as const satisfies Record<string, string>;

const FONT_VARIABLES = {
	"--pele-font": "--font-sans",
	"--pele-font-mono": "--font-mono",
} as const satisfies Record<string, string>;

export const PELE_FONT_SIZE = 14;

export const PELE_THEME_STYLE: CSSProperties = Object.fromEntries(
	Object.entries({ ...THEME_ROLES, ...FONT_VARIABLES }).map(([name, role]) => [
		name,
		`var(${role})`,
	]),
) as CSSProperties;

export type RoleResolver = (name: string) => string;

export function peleExportVariables(resolve: RoleResolver): string {
	const declarations: string[] = [];
	for (const [name, role] of Object.entries({
		...THEME_ROLES,
		...FONT_VARIABLES,
	})) {
		const value = resolve(role).replace(/"/g, "'").replace(/;/g, "");
		if (value !== "") declarations.push(`${name}:${value}`);
	}
	return declarations.join(";");
}

const ROOT_STYLE = /^(<svg\b[^>]*? style=")/;

export function inlinePeleTheme(svg: string, resolve: RoleResolver): string {
	const variables = peleExportVariables(resolve);
	if (variables === "" || !ROOT_STYLE.test(svg)) return svg;
	return svg.replace(ROOT_STYLE, `$1${variables};`);
}
