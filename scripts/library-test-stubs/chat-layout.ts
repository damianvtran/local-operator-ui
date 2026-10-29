/*
 * The Library page test bundles the shipped page, not the whole app shell.
 * Importing the real `chat-layout` pulls the fleet ask drawer and MUI into an
 * esbuild bundle that keeps packages external, where `@mui/material/styles` is
 * an ESM directory import Node cannot resolve. The page only needs the lane
 * hand-over hook, and outside the shell that hook is inert by contract.
 */
export const useLaneLeadingColumn =
	(_ground: "surface" | "elevated"): ((_column: HTMLElement | null) => void) =>
	() => {};
