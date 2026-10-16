# Qwen voice: try it locally

This guide is for trying per-session Qwen voice by hand before it merges. You talk to
the Qwen rig. The rig hands your words, exactly as heard, to the one conversation
that has voice turned on. Then the Qwen voice reads that conversation's reply back
to you, word for word.

The design is `docs/design/qwen-voice.md` on the backend branch.

Nothing here needs an API key, and nothing touches your real lop settings unless
you choose the optional variant in step 2b.

## 1. What has to be true first

- **Both branches are checked out**:
  - backend: `~/workspace/repos/lo-qwen-voice` on `feat/qwen-voice`;
  - app: `~/workspace/repos/lo-ui-qwen-voice` on `feat/qwen-voice`.
- **The rig runtime is installed** at `~/.local/share/qwen-voice-rig`. The app
  uses three things from it: `s2s-venv`, `qwa/node_modules` and `hf-cache`. It
  never runs `start.sh` and never writes into that folder. If yours lives
  elsewhere, set `LOP_QWEN_RIG_DIR=/path/to/rig` for step 3.
- **Headphones.** With speakers, the microphone can hear the reply. The app drops a
  take that repeats the last 30 s of speech, but headphones avoid the problem.
- **The version-1 rig is stopped**, so its ports are free. Run
  `~/.local/share/qwen-voice-rig/stop.sh` if it is running. Then check:

  ```sh
  for p in 3101 8765 8766 8080; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null && echo "port $p is BUSY" || echo "port $p free"; done
  ```

  All four must say `free`. If any port is busy, do not kill whatever holds it.
  Find out what it is first (`lsof -nP -iTCP:<port> -sTCP:LISTEN`).
  - 3101, 8765 and 8766 are the rig's ports.
  - 8080 is the test backend's port in step 2. The app's page may only talk to a
    backend on 1111 or 8080. Your everyday lop is on 1111, so the test one goes
    on 8080.
- **No key.** The test backend uses the `test` hosting and a mock model that
  answers "Hello from the mock provider!".

## 2. Start the test backend (safe default)

Run this in a terminal and leave it running. It uses a throwaway config folder and
a throwaway HOME, never `~/.local-operator`.

```sh
lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null && { echo "8080 is busy: stop here"; exit 1; }
export QV=$HOME/qwen-voice-trial            # any empty folder you own
mkdir -p "$QV/config" "$QV/home" "$QV/work"
cat >"$QV/config/config.yml" <<'YAML'
values:
  hosting: test
  model_name: mock-model
YAML
export QV_TOKEN=$(python3 -c 'import secrets; print(secrets.token_hex(24))')
cd ~/workspace/repos/lo-qwen-voice
env -u XPC_FLAGS HOME="$QV/home" LOCAL_OPERATOR_CONFIG_DIR="$QV/config" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$QV_TOKEN" \
  .venv/bin/local-operator serve --host 127.0.0.1 --port 8080 --hosting test --model mock-model
```

You need the `config.yml` lines. Without them, every message reaches the
conversation and is never answered.

### 2b. Optional: drive a real conversation

To talk to your real conversations, the app connects to your everyday daemon on
1111, so step 2 is skipped. That daemon must be running the code from
`~/workspace/repos/lo-qwen-voice`. Your installed lop does not have the voice
routes yet. Switching your everyday daemon to that branch, and onto your real
config, is your decision to make, so this guide does not script it.

## 3. Start the app

In a second terminal, from the app worktree:

```sh
cd ~/workspace/repos/lo-ui-qwen-voice
export QV=$HOME/qwen-voice-trial
VITE_DISABLE_BACKEND_MANAGER=true \
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
LOCAL_OPERATOR_DESKTOP_TOKEN="$QV_TOKEN" \
LOCAL_OPERATOR_CONFIG_DIR="$QV/config" \
npm run dev
```

Run it in the shell where you exported `QV_TOKEN`, or export the same value
again. For variant 2b, use `http://127.0.0.1:1111` and your daemon's own token
instead.

## 4. What to click

1. Create a conversation (New chat), or open one.
2. In the conversation's header there is a sound-wave button: "Turn on voice for
   this conversation". Press it.
3. What you should see:
   - the button turns accent-coloured;
   - "Starting voice" appears beside it;
   - a sound-wave mark appears on that conversation's row in the sidebar.
4. After about 20 s the speech models are loaded (16-20 s measured on a warm
   machine; the very first run can take longer):
   - the header says "Listening";
   - the Qwen page opens in your browser at `http://127.0.0.1:3101`.

   Allow the microphone there when your browser asks, and connect.

If you restart the app while voice is still on, nothing loads by itself. The
header shows "Start voice". Press it to load the models again.

## 5. What to say, and what should happen

Speak in the Qwen page, with headphones on.

| You say | You hear | You see in the app |
|---|---|---|
| "What files are here?" | "Sent." | Your exact words appear in the conversation as your message. The header says "Working". |
| (nothing; wait a second) | "Hello from the mock provider!" | That reply in the conversation. The header returns to "Listening". |
| Type `[bash:1] check the build` into the Qwen page's own text box and send it. The mock asks to run a shell command only when the words contain the literal `[bash:1]`, which speech will not spell, and the Qwen page's text box takes the same path as your voice. | "Sent.", then "Approval needed: bash. run: sleep 1" | An approval card for `bash`. The header says "Answer the question or approval on screen first." and a toast says "Approve or deny it on screen. Voice can't answer approvals." |
| "Yes, go ahead" (while the card is up) | "Answer it on screen first." | Nothing changes, and the words are not sent. Voice never answers a card. Click Approve or Deny on screen. |

Only an approval on a turn your VOICE started is read aloud. A card on a turn
you typed is shown on screen only, and voice refuses words while it is up.

To switch voice to another conversation:

1. Open a second conversation.
2. Press its voice button. The label says "Move voice to this conversation from …".
3. The first conversation's header goes quiet. The sidebar mark moves. You hear
   "Switched.".
4. Your next words go to the second conversation.

To turn voice off, press the button again. The models unload by themselves 10
minutes later. Quitting the app unloads them at once.

## 6. Stopping everything, and what to check if it does not talk

**Stop:** quit the app (Cmd+Q). This stops the rig processes the app started.
Then press Ctrl+C in the backend terminal. Delete `$QV` when you are done.

**It does not talk.** Check these in order:

1. **Microphone permission:** the browser must be allowed to use the microphone
   for `http://127.0.0.1:3101`.
2. **Ports:** re-run the port check from step 1 with the app closed. Something
   else on 3101, 8765 or 8766 makes the start fail, and the header says "Voice
   error". Hover it for the reason.
3. **Rig log:** the speech process writes to `qwen-s2s.log` in the app's data
   folder (`~/Library/Application Support/<app name>/qwen-voice/` in a packaged
   build, the dev profile's folder in `npm run dev`). The app's own log line
   starts with `qwen-voice:` or `qwen-rig:`.
4. **Wrong conversation:** words go only to the conversation with the accent
   button and the sidebar mark. If you hear "Voice is off for this
   conversation.", voice moved or was turned off.
5. **"Sent." but no reply:** the conversation is still working. Look at the
   conversation itself. A reply is spoken only for a turn your voice started.
