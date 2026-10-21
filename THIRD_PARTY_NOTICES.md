# Third-party notices

Notices and licence texts for third-party material redistributed inside this
application. `LICENSE` at the repository root is the project's own licence and
covers none of what is below.

## Geist Mono, Nerd Fonts patched (`GeistMonoNerdFontMono-Regular.otf`, `GeistMonoNerdFontMono-Bold.otf`)

Bundled at `src/renderer/src/assets/fonts/` and declared in that directory's
`fonts.css` as the `"Geist Mono"` family, which `--font-mono` resolves to. The
console pane renders agent-driven terminal output through the same face, which
is why this notice ships with the application rather than living only in the
repository.

Provenance, read off the two files rather than assumed (their `name` tables):
`Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git)`,
family `GeistMono NFM`, version string `Version 1.401;Nerd Fonts 3.4.0`, and the
face's own licence string "This Font Software is licensed under the SIL Open Font
License, Version 1.1". No Reserved Font Name is declared.

Two licences apply, and both texts follow.

### Geist Mono — SIL Open Font License 1.1

Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

### The Nerd Fonts patch — MIT

The patched files are derivatives produced by Nerd Fonts 3.4.0
(https://github.com/ryanoasis/nerd-fonts), whose own `LICENSE` states that
"Nerd Fonts source fonts, patched fonts, and folders with explicit OFL SIL
files are licensed under SIL OPEN FONT LICENSE Version 1.1", and that its
patcher source is MIT:

The MIT License (MIT)

Copyright (c) 2014 Ryan L McIntyre

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## xterm.js — `@xterm/xterm`, `@xterm/addon-unicode11`, `@xterm/headless`

Bundled into the application by the console pane: `@xterm/xterm` renders the pane's mirror
in the renderer, `@xterm/addon-unicode11` supplies the Unicode 11 width tables the pane
pins, and `@xterm/headless` is the terminal of record the main process keeps per surface.
All three are the same project (`https://github.com/xtermjs/xterm.js`) under the MIT
licence, at the versions `package.json` pins: `@xterm/xterm` 6.0.0,
`@xterm/addon-unicode11` 0.9.0, `@xterm/headless` 6.0.0.

The notice is here because the console pane is what made them redistributed rather than a
build-time dependency, and a licence record that named only the fonts would have been
incomplete in exactly the way code review round 1's B5 pointed out.

### xterm.js — MIT

Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Local voice models and code (`Moonshine`, `Supertonic`, `transformers.js`)

Not bundled: the local voice engine downloads its model files on first use, and
checks each one against a pinned SHA-256 (`src/voice-page/model-manifest.ts`).
Credit and terms for what it downloads and ports:

- **Moonshine Base** (`onnx-community/moonshine-base-ONNX`) — Useful Sensors.
  The model weights are MIT-licensed. The decode loop in
  `src/voice-page/moonshine.ts` follows the MIT-licensed `useful-moonshine-onnx`
  reference (https://github.com/moonshine-ai/moonshine).
- **Supertonic** (`Supertone/supertonic`; downloaded as the ONNX conversion
  `onnx-community/Supertonic-TTS-ONNX`) — Supertone Inc. The conversion is a
  conversion of `Supertone/supertonic` and carries its OpenRAIL-M licence
  (https://huggingface.co/Supertone/supertonic). It is not an OSI licence: it
  carries use restrictions that bind anyone who uses the model, and they are
  passed on here. Do not use it to impersonate a person, to deceive, or for any
  other use the licence prohibits; read the full text at the link before relying
  on it.
- **transformers.js** — Hugging Face. `src/voice-page/supertonic.ts` is a port of
  `SupertonicForConditionalGeneration.generate_speech` from transformers.js 4.3.1
  (https://github.com/huggingface/transformers.js), licensed Apache-2.0
  (https://www.apache.org/licenses/LICENSE-2.0). Changes: rewritten in
  TypeScript against `onnxruntime-web` directly.

### Voice page runtime packages

Bundled in the app (they run in the hidden voice page; see `src/voice-page/`):

- **`@ricky0123/vad-web`** — ISC licence. Voice-activity detection around the
  Silero model.
- **`onnxruntime-web`** — MIT licence, Microsoft Corporation. Runs the Silero VAD
  and, once downloaded, the Moonshine and Supertonic models. Its WebAssembly and
  WebGPU builds are copied into the app unchanged
  (`src/voice-page/engine-assets.ts`). Its own dependencies (`flatbuffers`,
  `guid-typescript`, `long`, `platform`, `protobufjs` and the `@protobufjs/*`
  packages) are Apache-2.0, BSD-3-Clause or MIT; each ships its licence in
  `node_modules/<package>/LICENSE`, which the packaged app carries.
- **Silero VAD v5** (`silero_vad_v5.onnx`) — MIT licence, Silero Team
  (https://github.com/snakers4/silero-vad). Bundled as shipped by `vad-web`.

### Supertonic use restrictions (OpenRAIL-M, Attachment A)

The Supertonic licence (`Supertone/supertonic`, which the downloaded
`onnx-community/Supertonic-TTS-ONNX` conversion carries) is the BigScience Open RAIL-M License dated August 18,
2022 (https://huggingface.co/Supertone/supertonic/raw/main/LICENSE, read
2026-10-20). Its Attachment A must pass to anyone who receives the model; it is
reproduced here verbatim:

> You agree not to use the Model or Derivatives of the Model:
> (a) In any way that violates any applicable national, federal, state, local or
> international law or regulation;
> (b) For the purpose of exploiting, harming or attempting to exploit or harm
> minors in any way;
> (c) To generate or disseminate verifiably false information and/or content with
> the purpose of harming others;
> (d) To generate or disseminate personal identifiable information that can be used
> to harm an individual;
> (e) To generate or disseminate information and/or content (e.g. images, code,
> posts, articles), and place the information and/or content in any context (e.g.
> bot generating tweets) without expressly and intelligibly disclaiming that the
> information and/or content is machine generated;
> (f) To defame, disparage or otherwise harass others;
> (g) To impersonate or attempt to impersonate (e.g. deepfakes) others without
> their consent;
> (h) For fully automated decision making that adversely impacts an individual's
> legal rights or otherwise creates or modifies a binding, enforceable obligation;
> (i) For any use intended to or which has the effect of discriminating against or
> harming individuals or groups based on online or offline social behavior or known
> or predicted personal or personality characteristics;
> (j) To exploit any of the vulnerabilities of a specific group of persons based on
> their age, social, physical or mental characteristics, in order to materially
> distort the behavior of a person pertaining to that group in a manner that causes
> or is likely to cause that person or another person physical or psychological
> harm;
> (k) For any use intended to or which has the effect of discriminating against
> individuals or groups based on legally protected characteristics or categories;
> (l) To provide medical advice and medical results interpretation;
> (m) To generate or disseminate information for the purpose to be used for
> administration of justice, law enforcement, immigration or asylum processes, such
> as predicting an individual will commit fraud/crime commitment (e.g. by text
> profiling, drawing causal relationships between assertions made in documents,
> indiscriminate and arbitrarily-targeted use).

Re-check the licence text when the pinned model revision in
`src/voice-page/model-manifest.ts` changes.

### Code the voice runners port from

- **`useful-moonshine-onnx`** — MIT licence, Useful Sensors
  (https://github.com/moonshine-ai/moonshine). The decoder loop in
  `src/voice-page/moonshine.ts` follows it.
- **transformers.js 4.3.1** — Apache-2.0, Hugging Face. The Supertonic runner
  (`src/voice-page/supertonic.ts`) and the Moonshine feeds follow its
  `modeling_supertonic.js` and `utils/tensor.js`. Changes: rewritten in
  TypeScript against `onnxruntime-web` directly.
