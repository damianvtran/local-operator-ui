# The composer's inline credential capture

Status: **agreed interface** (this file is the contract the implementation and its
review rounds are held to; it is not a proposal).

## What a user gets

The TUI already has a gesture for handing the agent a secret without the secret
ever becoming transcript text: type `/credential`, a space, then the value. The
desktop app has only a modal form (`CredentialPicker`, reached from the slash
row). This document ports the TUI gesture to the composer, so that:

1. typing `/credential ` (leading or **mid-prose**) arms a capture;
2. every character typed after the space is **masked** — one `•` per character,
   and the characters themselves never enter the buffer;
3. **Enter** ends the secret and turns it into an inline **pill** in the middle
   of the typed text, with the caret left after it so prose continues inline;
4. **Esc** cancels: the typed characters come back as ordinary plain text, and
   the app says so (they are plaintext now);
5. **paste** while armed captures the pasted content as the credential in one
   step, again leaving a pill;
6. on send, the value is stored in the **session credential store on the
   runtime** (the same store, the same verb, and the same injection into `bash`
   as the TUI uses). The model sees a citation naming the credential — never
   the bytes.

The normative reference for every sub-behaviour below is the TUI implementation
in `~/local-operator`: `local_operator/tui/widgets/editor.py` (the state
machine, `_capture_credential`, `_mint_typed_credential`,
`_cancel_credential_typing`, `generate_credential_key`, `substitute_credentials`,
`describe_unstored`) and `local_operator/tui/app.py`
(`_capture_inline_credentials`, `_store_inline_credentials`,
`session_credential_names`). **Read that code before implementing**; where this
document and that code disagree, that code wins and the divergence is a defect
in this document to be reported, not worked around. Where the port deliberately
diverges (there are three places, §7), the divergence is documented in the code
comment and in the PR.

## 1. The gesture is composer-local

The capture is a **composer** capability, not a slash-command execution. It arms
mid-prose exactly as it does in the TUI (`deploy with /credential <value>` is a
supported sentence), and the `/credential` token is **consumed** when the value
is chipped: the buffer afterwards holds the pill where the token was.

Two Enters, separated by **state** and never by timing — mirror the TUI's split:

- the slash suggestion popup is open and `/credential` is the highlighted row →
  Enter accepts the row (existing behaviour, unchanged). Accepting it inserts
  `/credential `, and that trailing space **opens the capture** (the TUI gets
  this from `_apply_command`, so a hand-typed space and a picker-accepted space
  are one rule);
- the masked span is open and holds at least one character → Enter **mints the
  pill** (§4);
- otherwise → submit, unchanged. In particular `/credential` with an empty span
  submits and the existing picker opens, which is how the store, the list and
  the forget verbs stay reachable.

## 2. Arming

The TUI's predicate, ported verbatim (`editor.py:551`):

```python
CREDENTIAL_ARM = re.compile(r"(?:^|(?<=\s))/(?:credential|cred)[ \t]*$", re.IGNORECASE)
```

- Leading **or** mid-prose; the token must start at line start or after
  whitespace, and must be the last thing on the caret's **own line** up to the
  caret. Trailing spaces and tabs are part of the match; a newline is not.
- **Only typing arms.** Text that arrives some other way — a restored draft, a
  history recall, a completion, seeded content, a programmatic `setValue` —
  never arms. The TUI enforces this by being the only arming route
  (`_sync_credential_arm`, "This is the ONLY way to arm"), and it is pinned
  there by `test_a_mention_of_the_command_in_text_never_typed_through_the_arm_does_not_arm`.
  This matters: `docs/design/...` prose that mentions the command, and a draft
  restored from a previous session, must not silently capture the next paste.
- The arm is **latched**, not re-derived per paste, and survives a newline, a
  typed word, a caret move, and an Esc that closes the popup. It ends only when
  the token is gone, the capture is taken, the span is cancelled, or a
  flag-shaped tail makes the tail an argument rather than a secret (`--…`: the
  first character typed into the span being `-` abandons the capture and leaves
  that `-` as plain text, which is how `/credential --forget-all` stays
  reachable in the TUI — `editor.py:2960-2983`).

## 3. Masking while typing

- One `•` (U+2022) per typed character, inserted through the composer's normal
  change path so selection, undo and the draft mirror behave as they do for any
  other text. One cell per character, never a wide glyph: the span's width and
  the pill's reported count have to agree.
- **The characters never enter the buffer.** This is the TUI's load-bearing
  invariant (`editor.py:6172-6177`, "BETWEEN (2) AND (4) THE SECRET IS NEVER IN
  THE DOCUMENT") and it is what makes every disclosure seam safe at once: the
  draft store, history, telemetry and the transcript all read the document.
  The value lives in a ref (§6).
- The gate is **printable characters**, never key names. The TUI documents the
  measured leak this fixes (`editor.py:2948-2959`: punctuation arrives spelled
  as words, and keying on names leaked a canary). Intercept the printable text
  the key would insert, not the key.
- Edits inside the span are applied **positionally to the held value**, so
  arrow-then-type, Backspace, Delete and select-and-replace land where the
  operator sees them land (`_credential_edit_mirror`, `editor.py:6242-6323`; the
  TUI lost a review round to exactly this, U1). The document invariant that
  makes this checkable: **while the span is open the buffer text is exactly
  `<prefix>/credential <• × len(value)><suffix>`**.
- A space typed inside the span is part of the secret (the delimiting space is
  not — it is the opener, and it is not counted in the length).
- The caret leaving the span ends the *typing* state without disclosing
  anything; returning to the token re-opens it (`test_the_caret_leaving_the_span_ends_the_capture_without_disclosing`,
  `test_the_caret_returning_to_the_token_re_opens_the_capture`).

## 4. Enter mints the pill

Read the TUI's `_mint_typed_credential` (`editor.py:6365-6417`) and mirror it:

- the token, the delimiting space and **every mask cell** are consumed in **one**
  edit — one undoable step, never an intermediate state holding a partly
  revealed secret;
- the replacement is `marker + " "`, and the caret lands after it, so typing
  continues inline and mid-prose;
- marker text, byte-for-byte the TUI's (`_capture_credential`, `editor.py:6095`):

  ```
  [Credential #<index>, <chars> chars]
  ```

  where `<index>` is a composer-local counter starting at 1 and `<chars>` is
  `Array.from(value).length` — **characters, never lines** (`_credential_label`,
  `editor.py:523-540`: the length is the operator's integrity check, and a line
  count is the weakest form of it exactly where truncation hides, as in a PEM
  block);
- an **empty** span mints nothing and the capture stays open;
- the marker is *not* distinguishable from a plain paste/image marker by its
  grammar alone, which is deliberate: `Marked = Attachment | PastedText | PastedCredential`
  in the TUI, and a citation counts as the app's own only when the marker text
  matches the payload's own recorded marker **and** the index matches. A
  hand-typed lookalike is prose and must never be stored, substituted or
  stripped.

## 5. Paste, and Esc

**Paste while armed** (`Editor._on_paste`, `editor.py:5194-5261`) — the credential
gate is the *first* branch, ahead of every size and whitespace rule:

- paste with an **open non-empty span** appends into the same secret through the
  same masking path;
- paste with an **open empty span** closes the span and then captures (so the
  §4 gesture still works after a stray space);
- otherwise the pasted text is captured directly: `value = pasted.trim()`, an
  **empty or whitespace-only paste captures nothing** and falls through to the
  ordinary paste (a zero-length credential would advertise a key that can never
  hold anything, and the store refuses a blank anyway);
- the capture is instant in one edit — never masked character by character — and
  **disarms**, so a second paste means retyping the token; the first marker stays
  cited and its payload untouched ("It is not a replacement").

**Esc** depends on which sub-state you are in, and only one of them disarms:

- **typing** (the space was typed: open span, empty or not) → **cancel**: the
  held characters are written back into the buffer **as ordinary text** — the
  only route by which a typed secret enters the document — the arm ends, and the
  operator is told, in the TUI's words, that the characters are now plain text
  and Enter will expose them (`CREDENTIAL_UNREDACTED_NOTICE`, "… characters are
  now PLAIN TEXT in the composer — Enter will expose them"). The `/credential `
  token is left behind as inert literal text. With no characters to restore the
  cancel still ends the mode (the TUI's R1/U2 regression: it used to re-arm
  itself and capture the prose that followed).
- **armed, no space yet** → Esc does **not** disarm. With the popup open it
  closes the popup; otherwise it keeps its existing meaning. The arm survives.
- The Escape restore must not re-arm: the TUI nests the restore in
  `_suspend_credential_sync = True` for exactly this reason.

## 6. Where the value lives, and what is persisted

- The value lives in a **ref-held map keyed by index**, alongside the minted key
  and the marker text: `{ index, key, value, marker }`. It is never React state
  that is serialised, never in the draft value, and never in
  `conversation-input-store` — that store is `persist`ed to localStorage, and
  any value routed through the draft buffer or `attachments` lands on disk
  (see `shared/store/conversation-input-store.ts`).
- **The draft is not written while a masked capture is open.** The persisted
  draft keeps the last non-capturing value; a half-typed secret is in-flight
  state, and persisting `••••` with no value behind it would restore dead text
  the operator cannot use. Document this rule in the code, with this reason.
- The marker text **is** persisted (it holds no secret) and a restored draft
  therefore repaints its pill. A restored payload starts with an empty value —
  the TUI's encoder deliberately does not write the value
  (`local_operator/tui/session_drafts.py:132-148`) — and a submit in that state
  finds nothing to store, so the citation says so (§9) rather than promising a
  key that nothing holds.
- Clearing the composer, submitting successfully, and disarming all clear or
  drop the map; a **failed send keeps it**, because the operator's unsent draft
  must not lose the value behind a pill they can see.

## 7. The three deliberate divergences from the TUI

1. **Pill rendering.** The composer is a plain `<textarea>` over a plain string
   draft, so there are no styled nodes to hang a chip on. The pill is drawn by a
   **background-only overlay**: a mirror element behind the textarea, with the
   same box model and typography (`whitespace-pre-wrap`, same font, size,
   line-height, letter-spacing, padding, border-box width), that paints a pill
   background under each marker span and **no text at all**. The textarea keeps
   painting every glyph, so a failure of the overlay can never make the user's
   text invisible, and the marker text and the pill can never disagree. The
   overlay is mounted **only while the buffer cites at least one marker**, so
   the ordinary composer keeps exactly today's render path. Scroll offset is
   synchronised when the textarea scrolls internally (it only does so past
   `max-h`).
2. **Key minting reads names asynchronously.** TUI mints synchronously from
   `session_credential_names()`. Here the taken names come from the desktop
   contract's `sessions.credential` / `list` call, so the names are fetched when
   the capture **arms** and cached; minting then stays synchronous at Enter. A
   failed or still-running fetch must not block minting — mint against what is
   cached, always including this composer's own in-flight keys.
3. **Draft persistence while typing**, as §6 states.

Everything else — the regex, the mask cell, the marker format, the citation
phrases, the naming convention, the disarm rules — is ported exactly, because
those are the parts whose behaviour the model and the session store depend on.

## 8. Naming the credential

Ported exactly (`editor.py:680-722`), because the name is the env var the model
must use and the store must not be silently clobbered:

- prefix `LOP_SECRET_`, then 8 symbols from `ABCDEFGHJKMNPQRSTVWXYZ23456789`
  (31 symbols, no lookalikes) — 39.3 bits;
- drawn from a **cryptographic** source (`crypto.getRandomValues`), never
  `Math.random`: a predictable name lets anything that can read the model's
  context guess the env var to look for;
- `taken` is the **union** of the session store's names and this composer's
  in-flight keys; a collision silently *replaces* a live credential
  (`store_credential` overwrites), so this is consulted rather than trusted to
  probability. Bounded retries (16) then a widened 16-symbol name, so it can
  never spin;
- the name must satisfy the backend's own pattern
  (`^[A-Za-z_][A-Za-z0-9_]*$`, ≤128) and round-trip the store's normaliser
  unchanged.

## 9. Sending: store, then substitute

At submit, with the TUI's `_capture_inline_credentials` as the reference:

1. **cited payloads, in citation order** — only markers still present in the
   buffer whose marker text matches the payload's own marker. A marker the user
   backspaced away is not cited, so its secret is never stored (the same rule
   that drops an uncited image).
2. store each one: `desktopResult({ op: "sessions.credential", sessionId,
   action: "store", key, value })` — the existing op and the existing route
   (`POST /v1/desktop/sessions/{id}/credentials`), which reaches the session's
   `credential_op` and therefore the same `VariableStore` the TUI writes and the
   same injection into `bash`. **No contract change and no backend change is
   needed or wanted**; if one starts to look necessary, stop and report it.
3. rewrite **every** citation, whether it stored or not, so the model is never
   handed a name it cannot use:
   - stored:
     `[credential LOP_SECRET_K3RQ7WZM (64 chars) — available to bash and eval as $LOP_SECRET_K3RQ7WZM; its value cannot be read]`
   - refused or unreachable: the TUI's `describe_unstored` sentence for the
     cause that actually applied (`null` → the session could not be reached;
     `empty-key` → the store rejected its name; otherwise the value did not
     survive, so ask the operator to paste it again). One authority for these
     phrases, shared by every path that writes one.
4. tell the operator, per outcome: on success the TUI's notice — *"Stored
   <keys>. Injected into every bash command as an environment variable; the
   agent cannot read the value."* — and on failure a warning naming the retry
   that actually works ("Paste the value again after `/credential`"), because
   there is no other gesture that retries a store. The existing toast helpers
   (`@shared/utils/toast-manager`) are the surface.
5. clear the map once the store holds the values.

The `/credential` argument must stay stripped from any command dispatch
(`slash-dispatch.ts`: `/credential` is refused so a secret can never land in
command text) — that guarantee is now stronger, not weaker, because the value
never enters the text at all. A message whose text cites a marker is a **normal
message**, not a slash command, even when the pill sits at the start of the
line: the token was consumed at mint time, so the leading-slash plan cannot fire
on a minted pill.

## 10. Acceptance criteria

- Leading **and** mid-prose gestures both work, and the pill sits inline in the
  surrounding text with the caret and the prose continuing after it.
- Typed characters are never in the buffer, the persisted draft, localStorage,
  the transcript, any log, or any telemetry payload; a canary secret must be
  greppable nowhere after a full store-and-send cycle.
- Enter/Esc/paste behave as §3-§5; the masked, armed, chipped and escaped states
  are each visible and each explained to the operator.
- A stored credential is reachable by the agent's `bash` tool as `$LOP_SECRET_…`
  in the same session, and the model's prompt contains the citation and never
  the bytes.
- A store that fails produces the honest citation and a notice, never a key
  nothing holds.
- The pill and the masked span are legible in **all twelve themes** (contrast
  floors from the branding contract), not only the two brand palettes.

## 11. Out of scope

- Changing the backend, the desktop contract, or the session store.
- Reworking the existing `CredentialPicker` (it stays, and stays the way the
  list/store/forget verbs are reached).
- Expanding a pill back into the buffer: the TUI refuses this for a credential
  (`ctrl+r` refuses; `action_expand_paste`), and so does this port.
- Multiple simultaneous captures (one span at a time).
