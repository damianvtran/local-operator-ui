/** Fictional structure-only reproduction of the rejected instruction document.
 * No source text or private document bytes are copied into this fixture. Inline
 * angle-tag syntax inside a list item and two standalone comments are enough to
 * trigger the shipped whole-document fallback despite otherwise readable prose. */
export const fictionalInstructionShape = [
	"# Working agreements",
	"",
	...Array.from({ length: 28 }, (_, index) =>
		index === 8
			? "- Treat <policy> markers as literal instruction syntax. Read [the fictional guide](https://example.invalid/guide) and keep `sample_value` unchanged."
			: `- Fictional rule ${index + 1}: inspect \`sample_${index + 1}\`, then explain **the result**.`,
	),
	"",
	"<!-- fictional:profile:start -->",
	"## Fictional context",
	"",
	"- Prefer *clear* explanations and ~~obsolete~~ examples only when labelled.",
	"- Keep the [reference](https://example.invalid/reference) readable.",
	"",
	"<!-- fictional:profile:end -->",
	"",
].join("\n");

export const extendedInstructionShape = `${fictionalInstructionShape}
## Structured examples

- Parent instruction
  - Nested instruction with \`literal <policy>\`
  - [ ] Pending fictional check
  - [x] Completed fictional check

> Preserve this quoted rule and **its emphasis**.

| Input | Rule |
| --- | --- |
| \`<sample>\` | Keep the literal value |

\`\`\`python
print("<fictional> must remain literal")
\`\`\`

Escaped angles: \\<fictional\\>. Double backticks: \`\`a\`b\`\`.

<fictional-policy priority="high">
Preserve this unsupported block exactly.
</fictional-policy>
`;
