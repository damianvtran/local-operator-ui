import { Fragment } from "react";

const LTR_RUN = /\u2066([^\u2069]*)\u2069/g;

/**
 * Render the shortcut runs prepared by `isolateLtr` as markup where JSX is
 * available. The same keyed sentence can also name a plain-text attribute;
 * only that attribute retains Unicode LRI/PDI. A tooltip must use real <bdi>
 * instead, so format controls do not leak into its DOM text or accessibility
 * tree. Catalogues contain neither controls nor markup; code owns direction.
 */
export function ShortcutText({ text }: { text: string }) {
	const parts = [];
	let offset = 0;
	for (const match of text.matchAll(LTR_RUN)) {
		parts.push(
			<Fragment key={match.index}>
				{text.slice(offset, match.index)}
				<bdi dir="ltr">{match[1]}</bdi>
			</Fragment>,
		);
		offset = match.index + match[0].length;
	}
	return (
		<>
			{parts}
			{text.slice(offset)}
		</>
	);
}
