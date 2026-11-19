import { t } from "@shared/i18n";

/**
 * The sentence that offers the built-ins, built from the names actually offered.
 *
 * It replaced copy that named activities rather than roles — "roles for coding,
 * review, design, research and coordination" — with no count at all: "research"
 * is not among the packaged profiles, architecture and testing went unnamed, and
 * the number only appeared once the batch had started ("Installing 1 of 6"), so
 * the sentence that sets the expectation for the whole flow was wrong about
 * both what is on offer and how much of it there is (UX round 1, U6). Derived
 * from the rows the backend sent rather than written by hand, because the
 * catalogue is the authority on what can be installed and a second list here
 * can disagree with it.
 */
export const builtinOfferSentence = (
	builtins: readonly { name: string }[],
): string => {
	const names = builtins.map((builtin) => builtin.name);
	/* ICU has no variable-length list argument. Folding through a select message
	 * lets translators own ALL punctuation and spacing, with separate two-item,
	 * middle and final joins (including a serial comma if their locale wants it).
	 * Zero/one items never ask for a join; agent names stay verbatim.
	 */
	const list = names.reduce((head, tail, index) => {
		if (index === 0) return tail;
		return t("ui.chat.sidebar.agents.list_join", {
			position:
				names.length === 2
					? "pair"
					: index === names.length - 1
						? "end"
						: "middle",
			head,
			tail,
		});
	}, "");
	return t("ui.chat.sidebar.agents.builtin_offer", {
		count: names.length,
		list,
	});
};
