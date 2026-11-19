/**
 * The addresses Team Bridge is willing to hand to the browser.
 *
 * ONE RULE, TWO READERS. The message markdown (`team-bridge-markdown.tsx`) links a
 * message's own text with it, and the link-preview card
 * (`link-preview/team-bridge-link-preview.tsx`) links a resolved card with it.
 * Answering "is this a destination" once is what keeps a card and its own link
 * text from disagreeing about where a message points.
 *
 * WHY ITS OWN MODULE. It used to live in `team-bridge-markdown.tsx`, which the
 * card imported. Mounting the card beneath a message body makes the message row
 * import the card, and the card importing the markdown renderer back would close
 * a module cycle through the row (#1722 review round 1, R1-M1). A leaf with no
 * imports cannot be part of one.
 */
export const EXTERNAL_HREF = /^(https?:|mailto:)/i;
