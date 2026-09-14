/**
 * AX-tree pruning and rendering for `snapshot`.
 *
 * LOCAL PORT of `extension/src/ax-compact.ts` in `damianvtran/local-operator` at
 * `d383e6bfe`. See `scroll-expressions.ts`'s header for the vendoring plan
 * (design 12.2) — this is the labelled local implementation until the lop-side
 * `extension/src/driver/` move lands.
 *
 * TODO(vendoring): replace with the vendored copy.
 *
 * The behaviour, verbatim from the original, because it is the difference
 * between a usable snapshot and a one-line one:
 *
 * An ignored node is excluded from the accessible tree but its subtree is NOT:
 * Chromium wraps every real page in ignored generic containers (html and body
 * surface as role "none", ignored: true) sitting directly under the RootWebArea.
 * Returning early on `ignored` therefore prunes the ENTIRE page and produces
 * one-line snapshots ('- RootWebArea "…" [e1]') that look like a browser
 * limitation and are actually this function. Treat ignored nodes as
 * transparent: emit no line and no ref (even if they carry `focusable`, e.g.
 * inside aria-hidden), keep the depth, and walk through to their children.
 *
 * The `visited` guard is not decoration: the walk trusts protocol data, and a
 * cyclic or duplicated `childIds` payload would otherwise recurse forever
 * inside the main process.
 */

/** A snapshot ref: where the node was, and the navigation epoch it belongs to.
 *
 * `epoch` is the load-bearing field. `click`/`type` refuse a ref whose epoch is
 * not the tab's current one, so "a pre-navigation ref pushed against a document
 * that no longer exists" fails with `element_not_found` rather than clicking
 * whatever now occupies those coordinates (design 6.4). */
export interface SnapshotRef {
	backendNodeId: number;
	epoch: number;
}

export interface AXValue {
	value?: unknown;
}

export interface AXNode {
	nodeId: string;
	backendDOMNodeId?: number;
	ignored?: boolean;
	role?: AXValue;
	name?: AXValue;
	childIds?: string[];
	properties?: Array<{ name: string; value: AXValue }>;
}

const LANDMARKS = new Set([
	"banner",
	"main",
	"navigation",
	"complementary",
	"contentinfo",
	"form",
	"region",
]);
const INTERACTIVE = new Set([
	"button",
	"link",
	"textbox",
	"checkbox",
	"radio",
	"combobox",
	"menuitem",
	"tab",
	"switch",
	"slider",
	"spinbutton",
]);

export function compactAX(
	nodes: AXNode[],
	epoch: number,
): { snapshot: string; refs: Record<string, SnapshotRef> } {
	const byId = new Map(nodes.map((node) => [node.nodeId, node]));
	const refs: Record<string, SnapshotRef> = {};
	const lines: string[] = [];
	let sequence = 0;
	const visited = new Set<string>();

	function visit(node: AXNode, depth: number): void {
		if (visited.has(node.nodeId)) return;
		visited.add(node.nodeId);
		if (node.ignored) {
			for (const child of node.childIds ?? []) {
				const found = byId.get(child);
				if (found) visit(found, depth);
			}
			return;
		}
		const role = String(node.role?.value ?? "");
		const name = String(node.name?.value ?? "").trim();
		const focusable = node.properties?.some(
			(property) =>
				property.name === "focusable" && property.value.value === true,
		);
		const interesting =
			INTERACTIVE.has(role) ||
			LANDMARKS.has(role) ||
			Boolean(focusable) ||
			Boolean(name && role !== "StaticText");
		if (interesting) {
			let ref = "";
			if (
				(INTERACTIVE.has(role) || focusable) &&
				node.backendDOMNodeId !== undefined
			) {
				ref = `e${++sequence}`;
				refs[ref] = { backendNodeId: node.backendDOMNodeId, epoch };
			}
			lines.push(
				`${"  ".repeat(depth)}- ${role || "node"}${name ? ` ${JSON.stringify(name)}` : ""}${ref ? ` [${ref}]` : ""}`,
			);
		}
		for (const child of node.childIds ?? []) {
			const found = byId.get(child);
			if (found) visit(found, interesting ? depth + 1 : depth);
		}
	}

	const childIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
	for (const root of nodes.filter((node) => !childIds.has(node.nodeId))) {
		visit(root, 0);
	}
	return { snapshot: lines.join("\n"), refs };
}
