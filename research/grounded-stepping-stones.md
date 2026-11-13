# How can Claude ground stepping stones in real measurements?

Research for [#30](https://github.com/ionlyaskforeta/elynt-music-tool/issues/30) on the map [Map: Mix & Master Assistant v1 spec](https://github.com/ionlyaskforeta/elynt-music-tool/issues/24). It builds on [How can AI help turn a track into a vision?](https://github.com/ionlyaskforeta/elynt-music-tool/issues/8) ([findings](https://github.com/IONLYASKFORETA/elynt-music-tool/blob/research/ai-vision/research/ai-vision.md)). Researched 2026-11-13. The vocabulary follows `GLOSSARY.md`: track, mixdown, stem, Live Set, bounce, stepping stone, mix mode, master mode, reference track and subgenre. A track in Ableton's own sense (one channel strip in the Live Set) is called a **Live track** here, because the glossary uses "track" for the song. See *Open questions*.

**Question.** How can Claude turn measurements and a parsed Live Set into stepping stones that are specific, correct and never invented? The ticket asks for six things:

- structured output checked against a schema;
- grounding each stone in a measured number and a Live track or device that exists;
- blocking advice on things that aren't there;
- what fits in context and what to summarise;
- the model and the cost;
- explaining the *why* in plain words.

## Answer in short

1. **Use structured outputs, and build the schema fresh for each Live Set.** `output_config.format` with a JSON schema constrains decoding, so the reply always parses and has every required field ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). The key move is to generate the schema from the parsed Live Set on every run. The `live_track` and `device` fields become `enum`s of the IDs that really exist in this project. Claude then *cannot emit* a Live track or device the project doesn't have.
2. **The schema can't check everything, so code validates after it.** The schema can't express "this device sits on that Live track" or "this number lies between −12 and +6". JSON Schema `minimum`/`maximum` aren't supported. A validator in code checks those links, clamps amounts, and rejects a stone that fails. It then asks Claude once to repair only the failed stones, and drops any stone that still fails. The app never shows a stone that failed validation.
3. **Claude never types a measured number.** Each stone cites measurement IDs, such as `m.bass.lufs_s.drop1`. Code looks those up and prints the value, the target and the gap. Prose fields may not contain digits, and the validator rejects any that do. Suggested amounts, such as "cut about 3 dB at 250 Hz", go in their own typed fields, which code clamps and formats. Every number Aden sees therefore came from code, from DSP or from a clamped field.
4. **Code writes the "where in Live" text.** It builds it from IDs, for example *Bass › EQ Eight › Band 3*. A suggestion to *add* a device must pick from an enum of Live's stock devices, taken from [Ableton's Audio Effect Reference](https://www.ableton.com/en/manual/live-audio-effect-reference/). Claude can't invent a third-party plugin Aden doesn't own.
5. **Send a compact summary, never the raw `.als` XML.** A `.als` file is gzipped XML ([dawtool source](https://raw.githubusercontent.com/offlinemark/dawtool/master/dawtool/daw/ableton.py)). Most of it (clips, notes, automation points, sample paths, plugin state) is useless to a mix move. Send one block per Live track: ID, name, kind, group, volume, pan, sends, and the device chain in order with the key parameters of each mixing device. Add the measurements per Live track and per section. That is an estimated 20 to 40K tokens for a 60-track Live Set, which fits in the 1M window many times over. The point of summarising is focus and cost, not fit. Measure the real size with the free [token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) endpoint.
6. **Use Claude Opus 5.5 (`claude-opus-5-5`) at effort `medium` or `high`. A run costs roughly $0.30 to $0.60 per mode.** The price is $4 per million input tokens and $20 per million output tokens ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). Thinking is always on and is billed as output ([thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)). A mix-then-master pass is about $1 at most. Sonnet 5.5 costs half as much and is worth A/B testing. Prompt caching cuts the cost of repeat runs on the same Live Set.
7. **Each stone's "why" follows a fixed pattern: heard → measured → move → check.** First the symptom Aden would hear, compared with the reference track by name. Then the measured cause, printed by code. Then the move. Then how to confirm it by ear and by number. Name the field `why`, not `reasoning`. Asking for reasoning in the output can trigger a `reasoning_extraction` refusal ([refusals](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#keep-reasoning-in-thinking-blocks)).
8. **Give Claude a proper way to say "I can't tell".** The schema has a `cannot_advise` list for gaps: a third-party plugin whose parameters it can't see, missing stems, or a measurement out of range. Anthropic's first anti-hallucination technique is to let the model admit uncertainty ([reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)).

## 1. Structured output that is checked against a schema

### What the API guarantees, and what it doesn't

- Structured outputs "guarantee schema-compliant responses through constrained decoding". In practice that means "Always valid: No JSON parsing errors", "Guaranteed field types and required fields" ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
- **Supported:** all basic types, `enum` (of strings, numbers, booleans or null), `const`, `anyOf`/`allOf` (with limits), local `$ref`/`$defs`, `required`, `additionalProperties: false`, string `format`s, simple regex `pattern`s, and array `minItems` of 0 or 1 only (same page, "JSON Schema limitations").
- **Not supported:** recursive schemas, `minimum`/`maximum`/`multipleOf`, `minLength`/`maxLength`, and array constraints beyond `minItems` 0 or 1. Using one returns a 400 error (same page). **So every numeric range check belongs in code.**
- **Complexity limits per request:** 20 strict tools, 24 optional parameters, and 16 parameters with union types (`anyOf` or `["string","null"]`). Above that comes "Schema is too complex for compilation", and compilation times out after 180 s (same page, "Schema complexity limits"). *Design consequence:* make every field required, and use a sentinel value such as `"none"` instead of a nullable union.
- **Grammar caching:** "The first time you use a specific schema, there is additional latency while the grammar compiles." Grammars are "cached for 24 hours from last use". Changing the schema's *structure* invalidates the cache. Changing only `name`/`description` does not (same page). A schema built per Live Set compiles again whenever Aden adds a Live track or device. Re-runs on an unchanged Live Set reuse the cache.
- **Ways it can still fail:**
  - `stop_reason: "refusal"`: "The output might not match your schema".
  - `stop_reason: "max_tokens"`: "The output might be incomplete".
  - Enum casing: "Structured outputs don't guarantee the capitalization of string `enum` and `const` values" (same page, "Invalid outputs").

  So check `stop_reason` before parsing, and compare enum values case-insensitively. Better still, make the IDs lowercase and opaque (`t07`, `d07_2`), so their case carries no meaning.
- **Citations can't be combined with it.** "If you enable citations … and also include the `output_config.format` parameter … the API returns a 400 error" ([citations](https://platform.claude.com/docs/en/build-with-claude/citations)). Grounding therefore has to come from our own ID references, not from the Citations feature.

### A sketch of the stepping-stone schema

This is illustrative, not a decision. `LIVE_TRACK_IDS`, `DEVICE_IDS` and `STOCK_DEVICES` are filled in from the parsed Live Set and from Live's device list at request time.

```json
{
  "type": "object", "additionalProperties": false,
  "required": ["stones", "cannot_advise"],
  "properties": {
    "stones": {"type": "array", "items": {
      "type": "object", "additionalProperties": false,
      "required": ["live_track", "device", "add_device", "move", "amount_db", "freq_hz",
                   "evidence", "headline", "why", "check", "confidence"],
      "properties": {
        "live_track": {"enum": ["t01", "t02", "...", "main"]},
        "device":     {"enum": ["none", "d01_1", "d01_2", "..."]},
        "add_device": {"enum": ["none", "EQ Eight", "Compressor", "Glue Compressor", "Utility", "Limiter", "..."]},
        "move":       {"enum": ["cut_eq", "boost_eq", "high_pass", "lower_fader", "raise_fader",
                                "compress_more", "compress_less", "narrow_stereo", "widen_stereo",
                                "sidechain_duck", "lower_limiter_gain", "set_ceiling", "other"]},
        "amount_db":  {"type": "number", "description": "Suggested change in dB, 0 if not applicable. Code clamps to -12..+6."},
        "freq_hz":    {"type": "number", "description": "Centre or cutoff in Hz, 0 if not applicable. Code clamps to 20..20000."},
        "evidence":   {"type": "array", "minItems": 1, "items": {"type": "string",
                       "description": "IDs from <measurements>, e.g. m.t07.band_200_400.drop1"}},
        "headline":   {"type": "string", "description": "Imperative, under 12 words, no digits."},
        "why":        {"type": "string", "description": "What Aden hears and why this move helps. Plain words, no digits."},
        "check":      {"type": "string", "description": "How to confirm by ear (A/B against the reference track). No digits."},
        "confidence": {"enum": ["high", "medium", "low"]}
      }}},
    "cannot_advise": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["live_track", "reason"],
      "properties": {"live_track": {"enum": ["t01", "...", "main", "project"]},
                     "reason": {"type": "string"}}}}
  }
}
```

Notes on the sketch:

- The order of stones in the array is the order of the checklist. It needs no separate field.
- `evidence` uses plain strings with `minItems: 1` rather than an enum. A Live Set with 60 Live tracks, 8 sections and about 15 metrics has thousands of measurement IDs. The docs say enum size and other factors add to an internal grammar-size limit, though they give no figure ("Beyond the explicit limits … there are additional internal limits on the compiled grammar size", same page). Start with code validation. Try an enum later if the grammar compiles quickly.
- Each Live Set has more than a few distinct optional fields, so all fields are required, and `"none"` and `0` stand for "not applicable". That stays inside the limits of 24 optional parameters and 16 unions.

## 2. Grounding every stone in a real number and a real Live track or device

This is a layered defence. Each layer catches what the one before it can't.

| Layer | What it blocks | Mechanism |
|---|---|---|
| Schema enums built per Live Set | Live tracks and devices that don't exist, and invented plugins | `enum` of real IDs. Stock devices to add come from Live's own list |
| Code validator | A device that isn't on the named Live track, an evidence ID that doesn't exist or belongs to a different Live track, amounts out of range, digits in prose, a stone that changes a device Aden has switched off | Deterministic checks after parsing. Clamp where safe, reject otherwise |
| One repair turn | Stones that failed validation | Send the validator's error list back and ask Claude to fix or delete only those stones |
| Drop | Anything still invalid | Leave the stone out, and log it so prompts can be tuned |
| Code renders the facts | Misquoted numbers and misspelt names | The UI prints measured values, targets, Live track names and device paths from the parsed data. Claude's text never carries them |

Why each layer is there:

- **Enums stop invention at the source.** Constrained decoding can only emit tokens the grammar allows ([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). A device ID that isn't in the enum can't appear.
- **Relational checks have to live in code.** JSON Schema can't say "device `d07_2` belongs to Live track `t07`", and the API rejects the range keywords. The Anthropic SDKs follow the same pattern for unsupported constraints. They strip them from the sent schema and "validate responses against your original schema and all its constraints" afterwards (same page, "SDK schema transformation").
- **Keeping numbers out of the prose is the strongest grounding rule.** Anthropic's guidance for long inputs is to ground claims in direct quotes or citations, and to "retract the claim" if no supporting quote is found ([reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)). Here the "quote" is a measurement ID. Code resolves it, so a quoted value can't be wrong. A stone whose evidence doesn't resolve is retracted, which here means dropped.
- **Restrict outside knowledge.** Tell Claude to base each stone only on the `<live_set>` and `<measurements>` blocks, and not on general assumptions about what a project "usually" has. The same Anthropic page lists this "external knowledge restriction" technique.
- **Measured values versus suggested amounts.** Measured values (LUFS, true peak, band energy, correlation, masking score) come only from the DSP code. Suggested amounts ("cut about 3 dB") are advice. Claude writes them in typed fields, and code clamps and rounds them to sensible steps, for example 0.5 dB.

### Stopping advice on things that aren't there

- **Live tracks and devices that are missing** are impossible because of the enums. Advice to *add* a device can only name a stock Live device from `STOCK_DEVICES`. The current Live 12 manual lists the stock effects, including Auto Filter, Channel EQ, Compressor, Drum Buss, EQ Eight, EQ Three and others ([Audio Effect Reference](https://www.ableton.com/en/manual/live-audio-effect-reference/)). The parser of the installed Live version, which is a separate research ticket, should supply the final list.
- **Third-party plugins.** If the parser can't read a plugin's parameters, the summary marks it `"params": "opaque"`. The prompt tells Claude it may refer to the plugin by name ("in your Pro-Q on Bass…") but must not assume its settings. Otherwise it should prefer a stock device placed after it, or put the gap in `cannot_advise`. The map lists this as *Not yet specified*. The schema gives it a clean outlet.
- **Missing audio.** If there are no stems, per-Live-track measurements don't exist, so per-Live-track spectral advice has no evidence IDs. The validator then rejects such stones automatically. The prompt should say that per-Live-track spectral claims need a stem.
- **Device state.** Include each device's on/off state and whether the Live track is muted or frozen, so Claude doesn't tune a switched-off device. The validator can also check this.
- **Prompt injection through Live track names.** Live track names, clip names and plugin preset names are text Aden or a sample pack wrote. Wrap the Live Set summary in tags. Opus 5.5's guidance is to mark pasted content with tags that carry a random ID, and to tell the model to follow instructions inside them only when the user asks ([Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)). The risk is low for a personal tool. It costs one line.

## 3. How much of the Live Set fits in context, and what to summarise

- **The window isn't the constraint.** Opus 5.5, Sonnet 5.5 and Haiku 5.5 all have a 1M-token window and 128K max output ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)).
- **The raw `.als` is the wrong input.** It is gzipped XML. A parser decompresses it with `gzip.decompress` and walks the tags. Live 12 names the main channel `MainTrack`, where Live 10/11 called it `MasterTrack` ([dawtool `ableton.py`](https://raw.githubusercontent.com/offlinemark/dawtool/master/dawtool/daw/ableton.py)). Most of the XML is clips, MIDI notes, automation envelopes, file references and plugin state blobs. None of that helps with a mix move, and it would cost tokens and attention.
- **Long-context guidance still applies.** Put the long data first and the instructions and query last. "Queries at the end can improve response quality by up to 30 percent in tests" ([prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), "Long context prompting"). Wrap each kind of input in its own XML tag (same page, "Structure prompts with XML tags").

**What to send** (summary JSON, order fixed so the prefix can be cached):

| Block | Content | Rough size (own estimate) |
|---|---|---|
| `<instructions>` (system) | Role, rules (no digits in prose, evidence required, stock devices only), the heard→measured→move→check pattern, 2–3 example stones | 3–5K tokens, cacheable |
| `<live_set>` | Per Live track: `id`, name, kind (audio/MIDI/group/return/main), parent group, mute/solo/frozen, volume dB, pan, sends, sidechain source, "automated: volume/pan/device params" flags. Device chain in order: `id`, stock/plugin name, on/off, and key parameters for mixing devices (EQ bands, compressor threshold/ratio/attack/release, Utility gain/width, Limiter ceiling). Plugins: name plus readable params, or `opaque` | 150–400 tokens × Live track, so about 10–25K for 60 Live tracks |
| `<targets>` | Subgenre targets and reference-track measurements (1–3 reference tracks) | 1–3K |
| `<measurements>` | Per Live track with a stem, per section: short-term LUFS, peak, crest factor, about 8 band energies against the target/reference, stereo width and correlation, plus the top masking pairs. Mixdown/master: integrated LUFS, LRA, true peak, PLR, spectral tilt. Each value carries its ID | 5–15K |
| `<task>` | "Mix mode: produce up to N stones, ordered by impact…" | <0.5K |

**What to leave out:** note and clip content, automation point lists (send a flag only), sample paths, plugin state blobs, arrangement locators beyond the section list, and anything about devices on muted Live tracks that aren't sent to the mix.

**Mode split.** Master mode needs the mixdown measurements, the master chain and the references, and hardly needs per-Live-track detail. Its input is therefore much smaller. Mix mode carries the full per-Live-track summary.

**Measure, don't guess.** The sizes above are this note's estimates. The [token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) endpoint is "free to use", with its own rate limits. Opus 5.5 uses the tokenizer introduced with Opus 4.7, so count with the model ID you will actually call (same page).

## 4. Which model, and roughly what a run costs

Prices are from [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). Thinking tokens "are billed as output tokens, even when the thinking text isn't returned" ([thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)).

| Model | Input / output per M | 5-min cache write / cache hit | Notes |
|---|---|---|---|
| **Claude Opus 5.5** `claude-opus-5-5` | $4 / $20 | $5 / $0.20 | Default. Thinking always on. Effort defaults to `medium` ([effort](https://platform.claude.com/docs/en/build-with-claude/effort)) |
| Claude Sonnet 5.5 `claude-sonnet-5-5` | $2 / $10 | $2.50 / $0.10 | "Fast" latency. Worth an A/B test |
| Claude Haiku 5.5 `claude-haiku-5-5` | $0.10 / $0.50 (≤100K prompt) | $0.125 / $0.01 | Fine for side jobs, such as rewriting a stone in plainer words. Not tested on judgement |

**Estimate per run** (own arithmetic; assumes about 30K input and 10–20K output including thinking):

| | Mix mode | Master mode (about 10K in, 5–10K out) | Both |
|---|---|---|---|
| Opus 5.5 | 0.12 + 0.20–0.40 ≈ **$0.32–0.52** | 0.04 + 0.10–0.20 ≈ $0.14–0.24 | **≈ $0.45–0.75** |
| Sonnet 5.5 | ≈ $0.16–0.26 | ≈ $0.07–0.12 | ≈ $0.23–0.38 |

- A repair turn adds well under one more run, because it only regenerates the failed stones.
- **Caching.** Keep the instructions, the Live Set summary and the targets as a stable prefix, so a re-run on the same Live Set within 5 minutes reads it at 5% of the input price. The minimum cacheable length is 512 tokens on Opus 5.5 and Sonnet 5.5, so even the system prompt alone can be cached ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). Changing the top-level `effort` between requests invalidates the cached messages ([Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)). Pick one effort per mode.
- **Batch** halves every price, but it is asynchronous ([pricing](https://platform.claude.com/docs/en/about-claude/pricing), "Batch processing"). It doesn't suit an interactive checklist. It is useful for re-scoring an eval set.
- **Effort.** Anthropic suggests starting Opus 5.5 at `medium` and testing other levels on your own evaluations, and says that at `medium` it "matches or exceeds Claude Opus 5 at `high`" ([Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)). Leave room in `max_tokens` for thinking; about 32K is safe here.
- **Refusals.** Opus 5.5 has safety classifiers and a `refusal` stop reason. Check `stop_reason` before parsing, and use the server-side `fallbacks` option ([refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)). Mixing advice is very unlikely to trigger one. A field called `reasoning`, `thinking` or `trace` is the one known trigger, so the schema avoids those names.

Together with the vision step's "under $1" per track ([ai-vision §1](https://github.com/IONLYASKFORETA/elynt-music-tool/blob/research/ai-vision/research/ai-vision.md)), Claude's spend on the whole suite stays around a dollar or two per track.

## 5. Explaining the *why* in plain words

What Anthropic's prompting guide supports:

- **Give Claude the motive, not just the rule.** "Providing context or motivation behind your instructions, such as explaining to Claude why such behavior is important … help[s] it deliver more targeted responses" ([prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), "Add context"). In practice the system prompt should say *who* Aden is: an EDM producer who acts on concrete moves in Live and has no use for theory lectures. It should also say *why* digits are banned: code prints the real numbers next to the text, so a number Claude typed could contradict them.
- **Show 2–3 example stones** in the system prompt. They set tone and length better than adjectives do (same page, "Use examples effectively").
- **Ask for a short explanation, not a reasoning trace.** A short "why" is fine. A field that asks for step-by-step reasoning can cause a `reasoning_extraction` refusal ([refusals](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#keep-reasoning-in-thinking-blocks)).

The pattern for one stone. The parts in braces are printed by code.

> **Cut the low-mids on Bass** · *Bass › EQ Eight › Band 2*
> **Heard:** in the first drop the bass and kick blur into one thud, and the drop sounds smaller than in *{Reference A}*.
> **Measured:** {Bass 200–400 Hz in drop 1: −14.2 dB vs reference −18.0 dB (+3.8 dB)} · {masking with Kick: high}
> **Move:** cut a wide bell around {250 Hz} by about {3 dB}.
> **Check:** loop the drop, A/B against *{Reference A}*. The kick should punch through without the bass getting thinner.

The prompt rules behind it:

- Start from the symptom a listener would notice ("blur", "harsh", "smaller than the reference"). Name the reference track and the section.
- One move per stone. Use an imperative headline under 12 words.
- Explain jargon in five words or fewer, or avoid it.
- Every stone ends with a **check** that Aden can do by ear. That ties into the map's open item on A/B listening in the checklist UI.
- Order stones by expected impact. Fix gain staging and balance before tone, and tone before width, within mix mode. This ordering is a craft assumption for the grilling ticket to confirm, not something from a source.
- For targets, cite the platform's own numbers rather than folklore. For example, Spotify normalises to "-14 dB LUFS" and asks for true peak at or below "-1dB TP", or "-2dB" if the master is louder than −14 LUFS ([Spotify for Artists](https://support.spotify.com/us/artists/article/loudness-normalization/)). Subgenre targets themselves belong to another ticket.

## 6. Suggested pipeline

1. **Parse** the `.als` into the Live Set summary, and give each Live track and device a stable ID.
2. **Measure** the bounces with DSP code, giving each value its own measurement ID.
3. **Build** the schema per Live Set, using Live track/device ID enums and the stock-device enum.
4. **Call** Opus 5.5 with structured outputs and the cached prefix. Check `stop_reason`.
5. **Validate** in code: relations, evidence, ranges, no digits in prose, device state.
6. **Repair** once if needed, then drop whatever still fails.
7. **Render** the stones. Code fills in names, paths, values, targets and gaps.

To test it, build a small eval set from 3–5 of Aden's finished Live Sets. Track the validator rejection rate, which should approach 0, and Aden's ticked-versus-skipped ratio. The hallucination page's "best-of-N verification" (run twice and compare) is a cheap check on how stable the stones are ([reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)).

## Open questions / not verified

- **Glossary gap.** "Track" means the song, but a stepping stone "names the track" in Ableton's sense. The glossary needs a term for one Ableton channel ("Live track" is used here). That is a job for `domain-modeling`.
- **Grammar size.** How large an enum of IDs (Live tracks × devices, or measurement IDs) can be before compilation is slow or fails. The docs give no number. This is a prototype question.
- **Token counts** of a real summarised Live Set. The figures above are estimates. Count them with `count_tokens` on one of Aden's Live Sets.
- **Plugin parameter visibility** in `.als` (VST3 state blobs and readable parameters). That depends on the separate `.als` parsing research.
- **Quality of Opus 5.5 versus Sonnet 5.5** on this task, and the best effort level. Not measured. Run an A/B on the eval set.
- **The final stock-device list for Live 12**. The manual page fetched here was cut off after Filter Delay, so the enum should come from the installed Live or the full manual.
