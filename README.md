# Cry Check — Pokémon Cry Matcher

A browser app for identifying which Pokémon's cry you just recorded off a
Mezastar machine, by comparing it against your own reference mp3 clips.

## Setup

1. Put these three files in one folder:
   - `index.html`
   - `style.css`
   - `app.js`
2. In that same folder, create a `sounds/` folder containing exactly these files:

   ```
   sounds/eternatus.mp3
   sounds/greninja.mp3
   sounds/grimsnarl.mp3
   sounds/hooh.mp3
   sounds/kaldeo.mp3
   sounds/lugia.mp3
   sounds/lunala.mp3
   sounds/solgaleo.mp3
   sounds/zeraora.mp3
   sounds/zygarde.mp3
   ```

   The filenames must match exactly (lowercase, no spaces) — that's how the
   app maps each card to its sound file.

3. You can't just double-click `index.html` to open it — browsers block
   microphone access and some file loading on `file://` pages. You need to
   serve it over `http://` instead. Easiest way, if you have Python installed:

   ```
   cd your-folder
   python3 -m http.server 8000
   ```

   Then open `http://localhost:8000` on the same phone/computer.

   If you don't have Python, any static file server works (VS Code's "Live
   Server" extension, `npx serve`, etc).

4. On your phone, open that local address in the browser, allow microphone
   access when asked, and you're set.

## How to use it

- **Roster grid (top):** tap any Pokémon to loop its reference cry. Tap again
  to stop. Use this to refresh your memory on what each one sounds like.
- **Scan a cry (main event):** tap the big button to record through your
  phone mic, or use "Upload a clip" if you already have a recording saved.
  The ring around the button shows live mic level, so you can tell if you're
  actually picking up sound over the mall noise.
- **Relisten mode:** once you have a captured clip, tap this to loop it back
  so you can A/B it by ear against the roster cards above.
- **Results:** after capture, the app shows your top 3 candidates ranked by
  similarity score, plus a "show remaining" toggle for the rest. It never
  auto-declares a winner — tap whichever candidate you believe is correct to
  mark it confirmed. Treat the scores as a shortlist to narrow down, then use
  relisten mode and the roster cards to make the final call by ear.

## How the matching works

It's not a simple "does the audio look the same" check — that fails badly
once mall noise is involved. Instead, each clip gets broken into short
overlapping audio frames, and for each frame the app builds a profile of how
much energy stands out in different frequency bands, specifically compared to
the local noise floor around each band. That last part matters: it's what
lets a real tonal cry stand out from broadband crowd/mall noise, rather than
getting outvoted by how loud the noise happens to be.

The app then slides your captured clip's profile across each reference clip
looking for the best-aligned match, so it doesn't matter if there's a bit of
silence or stray noise before or after the actual cry in your recording.

Recording tips for better results:
- Get the phone mic as close to the machine speaker as you reasonably can.
- A clean recording with the actual cry, and not much else, scores far
  better than one with the cry buried in three seconds of mall ambience.
- If results look close or wrong, use relisten mode and the roster cards to
  cross-check by ear — the score is a strong hint, not a verdict.
