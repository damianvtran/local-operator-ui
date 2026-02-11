import { type IconNode, type LucideIcon, createLucideIcon } from "lucide-react";

/**
 * Creates project-owned icons with the same component contract as lucide icons.
 */
export const createCustomIcon = (
	displayName: string,
	iconNode: IconNode,
): LucideIcon => createLucideIcon(displayName, iconNode);

/**
 * A lightweight "spark with orbit" icon used where no close lucide equivalent exists.
 */
export const OrbitSpark = createCustomIcon("OrbitSpark", [
	["circle", { cx: "12", cy: "12", r: "2", key: "center" }],
	["path", { d: "M4 12a8 8 0 0 1 8-8", key: "arc-top" }],
	["path", { d: "M20 12a8 8 0 0 1-8 8", key: "arc-bottom" }],
	["path", { d: "M18.5 5.5v3", key: "spark-v" }],
	["path", { d: "M17 7h3", key: "spark-h" }],
]);
