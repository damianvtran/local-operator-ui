# Qwen voice: try it locally

This guide is for trying per-session Qwen voice by hand before it merges. You talk to
the Qwen rig. The rig hands your words, exactly as heard, to the one conversation
that has voice turned on. Then the Qwen voice reads that conversation's reply back
to you, verbatim up to whitespace normalisation.

The design is `docs/design/qwen-voice.md` on the backend branch.

Nothing here needs an API key, and nothing touches your real lop settings, your
everyday daemon on 1111 or your installed Local Operator app. Your installed app
can stay open the whole time: the trial app runs on its own profile folder.

Every block below is safe to paste into an interactive terminal. None of them
closes your shell if a check fails; they print what is wrong instead.

## 1. What has to be true first

- **Both branches are checked out**:
  - backend: `~/workspace/repos/lo-qwen-voice` on `feat/qwen-voice`;
  - app: `~/workspace/repos/lo-ui-qwen-voice` on `feat/qwen-voice`.
- **The rig runtime is installed** at `~/.local/share/qwen-voice-rig`. The app
  uses three things from it: `s2s-venv`, `qwa/node_modules` and `hf-cache`. It
  never runs `start.sh` and never writes into that folder. If yours lives
  elsewhere, add `LOP_QWEN_RIG_DIR=/path/to/rig` to the step 3 command.
- **Headphones.** With speakers, the microphone can hear the rig. The app drops
  anything that is one of the rig's own short phrases ("Answer it on screen
  first.", "Switched." and so on), or that repeats a reply spoken in the last
  30 s. Headphones avoid the problem altogether.
- **The ports are free.** Run:

  ```sh
  for p in 3101 8765 8766 8080; do
    if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null; then echo "port $p is BUSY"; else echo "port $p free"; fi
  done
  ```

  - **8080** is the test backend's port in step 2. It must be free. The app's
    page may only talk to a backend on 1111 or 8080; your everyday lop is on
    1111, so the test one goes on 8080.
  - **3101, 8765, 8766** are the rig's ports: the Qwen page, the speech process
    and the relay. If the version-1 rig is running, stop it with
    `~/.local/share/qwen-voice-rig/stop.sh`. If any of the three is held by
    something else, do not kill it. Pick three free ports instead and set
    `LOP_QWEN_PORTS` in step 3, for example `LOP_QWEN_PORTS=3191,8795,8796`
    (the order is page, speech, relay). This works only in the dev app; a
    packaged app always uses 3101, 8765 and 8766.
- **No key.** The test backend uses the `test` hosting and a mock model that
  answers "Hello from the mock provider!". The mock also titles every
  conversation with that same sentence, so the strip's "voice is on in …"
  notice names it in each case - a mock artifact, not the app.

## 2. Start the test backend (terminal 1)

Run this in a terminal and leave it running. It uses a throwaway config folder and
a throwaway HOME, never `~/.local-operator`. It writes the backend's access token
to `$QV/token`, readable only by you, so terminal 2 can read it.

```sh
export QV=$HOME/qwen-voice-trial            # any folder you own; deleted in step 6
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null; then
  echo "8080 is busy: stop whatever holds it first (lsof -nP -iTCP:8080 -sTCP:LISTEN)"
else
  mkdir -p "$QV/config" "$QV/home" "$QV/work" "$QV/profile" "$QV/logs"
  printf 'values:\n  hosting: test\n  model_name: mock-model\n' >"$QV/config/config.yml"
  (umask 077; python3 -c 'import secrets; print(secrets.token_hex(24))' >"$QV/token")
  cd ~/workspace/repos/lo-qwen-voice
  env -u XPC_FLAGS HOME="$QV/home" LOCAL_OPERATOR_CONFIG_DIR="$QV/config" \
    LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$QV/token")" \
    .venv/bin/local-operator serve --host 127.0.0.1 --port 8080 --hosting test --model mock-model
fi
```

You need the `config.yml` lines. Without them, every message reaches the
conversation and is never answered.

## 3. Start the app (terminal 2)

Open a second terminal and paste this. It runs the trial app on its own profile
folder (`$QV/profile`), so it does not collide with your installed app, and it
names a normal window so the window shows up. Telemetry is off. The four
`VITE_GOOGLE_*`/`VITE_MICROSOFT_*` values are placeholders: the dev build refuses
to start without them, and nothing here signs in to Google or Microsoft.

```sh
export QV=$HOME/qwen-voice-trial
if [ ! -s "$QV/token" ]; then
  echo "No $QV/token: run step 2 first, in terminal 1"
else
  cd ~/workspace/repos/lo-ui-qwen-voice
  VITE_DISABLE_BACKEND_MANAGER=true \
  VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=placeholder VITE_GOOGLE_CLIENT_SECRET=placeholder \
  VITE_MICROSOFT_CLIENT_ID=placeholder VITE_MICROSOFT_TENANT_ID=placeholder \
  LOCAL_OPERATOR_UI_TELEMETRY=off \
  LOCAL_OPERATOR_LOG_DIR="$QV/logs" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$QV/token")" \
  LOCAL_OPERATOR_CONFIG_DIR="$QV/config" \
  npx electron-vite dev -- --user-data-dir="$QV/profile" --window-mode=normal
fi
```

If 3101, 8765 or 8766 were busy in step 1, put `LOP_QWEN_PORTS=3191,8795,8796 \`
(your three free ports) on its own line before `npx`.

You should see a window titled Local Operator, separate from your installed app.
The terminal prints the dev server's lines and stays open while the app runs.

Because the profile folder is new, the app first shows a **"Connect an AI
account"** window. Press **"Skip for now"**: the test backend needs no account.

## 4. What to click

1. Open a conversation and send it a first message by typing, for example
   "hello". **The voice button appears only once a conversation has its first
   message**; a fresh New chat draft does not have one yet.
2. In the composer's control row, between the microphone and Send, there is a
   sound-wave button: "Turn on voice for this conversation". Press it.
3. What you should see:
   - the button turns accent-coloured;
   - a band appears at the top of the composer box, above the textarea, whose
     chip reads **"Starting voice"**;
   - a sound-wave mark appears on that conversation's row in the sidebar.
4. After about 15-20 s the speech models are loaded (the very first run can take
   longer). The app opens its own hidden Qwen page - no browser tab, nothing to
   click - and the strip's chip changes from **"Starting voice"** to
   **"Listening"** once that page is connected.

   **The first time, macOS asks for the microphone - before the models load**,
   so a denial costs no memory and the prompt is not hidden behind a minute of
   "Starting voice". If you allow it, voice carries on. If nobody answers for
   five seconds the strip's chip says **"Waiting for microphone permission…"**
   with **"Open Settings"**; if you deny it, the chip says **"Microphone
   blocked"** with the same action. Either way the action opens the macOS Microphone pane
   for this app; change it there, then turn voice off and on again.

   (A source checkout shows this prompt against the process that launched the
   app - the session host, not the dev app - because macOS attributes a prompt
   to the responsible process. The packaged app is its own bundle and answers
   its own prompt.)

   **The Qwen page's own welcome text does not apply here.** It says "You
   speak, I orchestrate." and suggests things to try. In this setup the page is
   only the microphone and the speaker: EVERYTHING you say, including "hello",
   goes to the conversation with voice on, and what you hear back is that
   conversation's reply.

5. If the strip's chip says **"Voice page not connected"** with **"Retry"**, the
   hidden page is not talking to the Gateway. Press Retry: it recreates the
   page. Nothing else needs a browser.

   You do not close a tab any more, and voice keeps listening while the app is
   in the background: the page is deliberately not throttled.

6. Pause and mute are the strip's two icon controls beside the chip.
   - **Pause** (the two bars) closes the app's hidden voice page. The microphone
     is released - so dictation in the composer works again - and the speech
     models stay loaded: nothing is unloaded, nothing reloads. The chip reads
     **"Paused"** and the same button becomes **Resume**, which recreates the
     page. Pause does not restart the ten-minute idle clock; the models stay
     warm until you turn voice off or that clock runs out.
   - **Mute** (the speaker) silences only the assistant's spoken replies, using
     `webContents.setAudioMuted` on the hidden page. Your app, its notifications
     and everything else on the machine keep their sound. It is remembered
     across a resume and across a page recreated by Retry, and it is not written
     to any config file.

If you restart the app while voice is still on, nothing loads by itself. The
strip's chip reads **"Voice idle"** - the conversation still holds voice, so
the wave beside the mic stays lit - and the LIT WAVE is the way back in: press
it to load the models again. Press it a second time, once voice is running, to
turn voice off.

## 5. What to say, and what should happen

Speak, with headphones on. There is no page to speak into: the app's own
hidden page is listening.

| You say | You hear | You see in the app |
|---|---|---|
| "Hello" | "Hello from the mock provider!" | "Hello" appears in the conversation as your message, then the mock's reply. The strip says "Working", then "Listening". |
| "What files are here?" | nothing until the reply | Your exact words appear in the conversation as your message. The strip says "Working". |
| (nothing; wait a second) | "Hello from the mock provider!" | That reply in the conversation. The strip returns to "Listening". |

**Approvals.** The mock asks to run a shell command only when a conversation's
**first** message contains the literal `[bash:1]`. Speech will not spell that,
and a later message does not trigger it, so this needs a NEW conversation:

1. Click New chat, type `[bash:1] check the build` and send it.
2. Press the new conversation's voice button. The label says
   "Move voice to this conversation from “…”". You hear "Switched.".
3. Speak a follow-up, for example "please also check the tests".

| You say | You hear | You see in the app |
|---|---|---|
| "Please also check the tests" while the card is up | "Answer it on screen first." | An approval card for `bash`, and the strip's chip reads "Approve on screen" with "Answer the question or approval on screen first." and the refused words beside it — the band says you were heard and deliberately not sent, because the card must be answered there. Voice never answers a card. Click Approve or Deny on screen. |
| "Yes, go ahead" (while the card is up) | "Answer it on screen first." | Nothing changes. |

If you are looking at another conversation when a card appears in the voice
conversation, a toast tells you, with an "Open" button that takes you there.

Only an approval on a turn your VOICE started is read aloud ("Approval needed:
bash. …"). A card on a turn you typed, like the one above, is shown on screen
only, and voice refuses words while it is up.

To switch voice to another conversation:

1. Open a second conversation (one that already has a message).
2. Press its voice button. The label says "Move voice to this conversation from
   “<first conversation's title>”". (In the first conversation, the strip is
   replaced by a one-line notice - "Voice is on in <title>" - with **"Move
   here"** and **"Go there"**.)
3. The first conversation's strip goes quiet. The sidebar mark moves. You hear
   "Switched.".
4. Your next words go to the second conversation.

**Turning voice off** (press the button again) stops your words reaching any
conversation; if you speak, you hear "Voice is off for this conversation.". It
does **not** close the microphone: the hidden page keeps it open while the rig is
up, so the macOS microphone indicator stays on until the models unload - 10
minutes after voice is turned off - or the app quits.

## 6. Stopping everything, and what to check if it does not talk

**Stop:**

1. Quit the trial app (Cmd+Q in its window, or Ctrl+C in terminal 2). This
   stops the rig processes the app started.
2. Press Ctrl+C in terminal 1 to stop the test backend.
3. Delete the trial folder: `rm -rf "$HOME/qwen-voice-trial"`.

A `kill -TERM` of the app is covered too: the signal stops the rig and clears
its `s2s.json` record before the process exits.

**If the app crashed or was force-quit**, the speech process it started can be
left running (about 5 GB of memory, holding port 8765). You do not need to find
it: the next time you start voice, the app recognises the process it started
earlier, from the record it keeps in `$QV/profile/qwen-voice/s2s.json`, and
stops it before loading the models again. You only see a slightly longer
"Starting voice". It never stops a process it did not start; if something else
holds the port, the strip's chip says "Voice error" with the reason.

**It does not talk.** Check these in order:

1. **The strip says "Microphone blocked":** macOS has denied this app the
   microphone. Press "Open Settings", allow Local Operator (in the dev app, the
   entry is "Electron"), then turn voice off and on again.
   **The strip says "Voice page not connected":** the hidden page never
   connected. Press "Retry"; if it stays that way, the logs in item 4 say why.
2. **Nothing is asked and nothing connects:** check `LOP_QWEN_NO_WEBUI` is not
   set in the app's environment - it is the switch that creates no page at all,
   for agent-driven runs.
3. **"Voice error":** the reason is written beside it, and "Try again" restarts
   the models. "Voice stopped unexpectedly." means a rig process died while
   voice was on. A failed start shows its cause, for example "Port 8765 is in
   use; stop the other voice rig first" or "Voice rig not found at …"; hover it
   for the full text if it is cut short. "Your last words were not sent."
   is about one take only; the next thing you say is tried again. "Voice
   stopped: it used more than N GB" is the memory guard: the rig passed its
   budget (8 GB, or a quarter of RAM if that is larger) and was stopped before
   it could take the machine with it. `LOP_QWEN_MEM_BUDGET_GB` moves the number,
   and under 16 GB of RAM voice refuses to start at all.
4. **Logs:**
   - the speech process: `$QV/profile/qwen-voice/qwen-s2s.log`;
   - the app, including its `qwen-voice:` and `qwen-rig:` lines:
     `$QV/logs/backend-service.log`;
   - the test backend: terminal 1.
5. **Wrong conversation:** words go only to the conversation with the accent
   button and the sidebar mark. If you hear "Voice is off for this
   conversation.", voice moved or was turned off.
6. **Your words appear but no reply is spoken:** the conversation is still
   working, or the turn was not one voice started. Look at the conversation
   itself: a reply is spoken only for a turn that carries a take.
