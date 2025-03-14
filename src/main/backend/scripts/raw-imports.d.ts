/**
 * Type declarations for raw file imports
 */

declare module "*.sh?raw" {
	const content: string;
	export default content;
}

declare module "*.ps1?raw" {
	const content: string;
	export default content;
}
