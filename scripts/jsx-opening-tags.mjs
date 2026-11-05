/**
 * Every opening tag in a source file, as `{ name, text }` pairs, in order.
 *
 * A parser this is not; it is the smallest walk that can say WHICH element an
 * attribute is on, which a file-level `includes` cannot. Block comments are
 * stripped first so a marker named in prose does not count as a marker on an
 * element. From a `<`, the tag ends at the first `>` at brace depth zero - so
 * `[&>div]` inside a className does not end it - and quotes are honoured so a
 * `>` inside a string does not either. TypeScript generics like
 * `forwardRef<HTMLDivElement, ...>` are taken as tags too; their names never end
 * in `Content`, `Overlay` or `Panel`, so they are inert at the call sites, and
 * the walk resumes after them.
 *
 * A SINGLE QUOTE IS NOT A DELIMITER HERE, and that is a measured correction
 * rather than a shortcut. Treating `'` as a quote opener made the walk swallow the
 * whole of `tooltip.tsx`: it started at `forwardRef<`, met an apostrophe in the
 * prose of a comment, and stayed "inside a string" until the next one far below -
 * so the element carrying `data-glass-overlay` was never visited and the check
 * reported that no portalled panel existed in the file at all. In this directory
 * no string literal is single-quoted (the formatter's double-quote rule), so a `'`
 * is always prose and never a delimiter.
 *
 * SHARED RATHER THAN COPIED, because two contracts now ask the same question of
 * the same primitives - the drag opt-out (`overlay-drag-zones.test.mjs`) and the
 * glass marker (`glass-overlay.test.mjs`). One walk, so a fix to the quote/brace
 * handling holds for both and the two can never disagree about which element an
 * attribute sits on.
 */
export const openingTags = (source) => {
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const tags = [];
	for (let i = 0; i < stripped.length; i++) {
		if (stripped[i] !== "<") continue;
		const next = stripped[i + 1];
		if (!(next !== undefined && /[A-Za-z]/.test(next))) continue;
		let depth = 0;
		let quote = null;
		let end = -1;
		for (let j = i + 1; j < stripped.length; j++) {
			const ch = stripped[j];
			if (quote !== null) {
				if (ch === quote && stripped[j - 1] !== "\\") quote = null;
				continue;
			}
			if (ch === '"' || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "{") depth += 1;
			else if (ch === "}") depth -= 1;
			else if (ch === ">" && depth === 0) {
				end = j;
				break;
			}
		}
		if (end === -1) continue;
		const text = stripped.slice(i, end + 1);
		const name = /^<([A-Za-z][\w.]*)/.exec(text)?.[1];
		if (name === undefined) continue;
		tags.push({ name, text });
		i = end - 1;
	}
	return tags;
};
