# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot...) working on this repo. Humans can read it too.

This project openly mocks vibe coding. Don't prove it right: small, tested, honest changes only.

# What this is

A Firefox extension (Manifest V2) that blocks ads with EasyList and replaces each ad box with a random, muted, looping file from `video/playlist.txt` (Subway Surfers gameplay by default).

Plain JavaScript. No framework, no npm dependencies, no bundler, no TypeScript. The `Makefile` just zips the files into an `.xpi`.

How to install, use and customize it is in [README.md](README.md). Read it before changing anything.

# Files

| File | Role |
| --- | --- |
| `manifest.json` | permissions, scripts, Firefox add-on id |
| `background.js` | loads EasyList (saved copy, else bundled copy), refreshes it every 4 days, cancels ad requests, injects the detection CSS into pages |
| `filters.js` | parses EasyList: host rules (`\|\|host^`), element rules (`##selector`), plus `EXTRA_SELECTORS` |
| `playlist.js` | reads `video/playlist.txt`, picks a random file for each ad, loads each file once as a blob URL |
| `content.js` | finds ad boxes and replaces them with a `.sws-slot` holding a `<video>` or an `<img>` |
| `content.css` | style of `.sws-slot` |
| `filters/easylist.txt` | bundled EasyList. Never edit it by hand |
| `video/playlist.txt` | one file name per line, files live in `video/` |
| `Makefile` | `make`, `lint`, `sign`, `update-filters`, `clean`, `fclean`, `re` |

# How the pieces talk

1. `content.js` starts in every frame and sends `{ type: "init" }`.
2. `background.js` answers by injecting CSS that gives every ad selector a 1 ms animation named `sws-detect`.
3. `content.js` listens for `animationstart` with that name. Each element that fires it is an ad: it gets queued, measured, then replaced by a slot of the same size (or hidden if it never gets a size).
4. Ad frames cancelled by `background.js` are reported with `{ type: "blockedFrame", url }` and replaced too. Iframes with a standard ad size (`AD_SIZES`) are replaced unless their host is in `EMBED_HOSTS`.
5. `fillSlot()` calls `pickMedia()` from `playlist.js` (content scripts share one scope) and puts a `<video>` or an `<img>` in the slot. Videos only play while visible (`IntersectionObserver`).

# Rules

- Firefox only. Use `browser.*` (promises), not `chrome.*`.
- Stay on Manifest V2. A Manifest V3 migration is its own pull request, never a side effect.
- No new dependencies, frameworks or build tools. If plain JavaScript and the `Makefile` can't do it, open an issue first.
- No new permissions, no remote code, no analytics, no tracking. The only request the extension makes by itself is EasyList (`LIST_URL`). `data_collection_permissions` stays `none`.
- Never edit `filters/easylist.txt` by hand: run `make update-filters`. Extra selectors go in `EXTRA_SELECTORS` in `filters.js`.
- Every file the extension needs at runtime must be in `SRC` in the `Makefile`, or it won't be in the `.xpi`. Files named in `video/playlist.txt` are added automatically.
- New content script? Add it to `manifest.json` (before `content.js` if `content.js` uses it) and to `SRC`.
- Keep media small: everything in the playlist ships inside the extension.
- Match the existing style: 2 spaces, double quotes, semicolons, `const`/`let`, small functions, short comments only where they help. Don't reformat code you didn't change.
- Don't touch `version` in `manifest.json` unless a maintainer asks.
- Never commit `build/`, `dist/` or `.xpi` files.
- `README.md`: keep the authors' intro, rant and "Final note" exactly as they are. If your change affects install, usage, file names, `make` targets or the playlist, update the README in the same pull request.

# Test before you open a pull request

1. `make` builds `dist/sws-extension-<version>.xpi` with no error.
2. `make lint` reports 0 errors and 0 warnings. Keep it that way.
3. In Firefox: `about:debugging#/runtime/this-firefox` > **Load Temporary Add-on...** > `manifest.json`. Open 2 or 3 websites with ads (news sites are perfect) and check that:
   - ads are replaced, the page layout isn't broken, videos play;
   - a YouTube embed on a normal page still works;
   - there are no errors in the console (**Inspect** in `about:debugging` for `background.js`, the page console for `content.js`).
4. Can't run Firefox (sandbox, CI...)? Say it in the pull request. Never claim a test you didn't run.

# Commits

`type: what changed`, lowercase, no final period, like the existing `chore: add very valuable readme`.

Types: `feat`, `fix`, `docs`, `chore`, `refactor`.

# Pull requests

Write the pull request the way `README.md` is written: Markdown with `#` headings, short sentences, plain English, and some of the README's dry humor if it fits. Jokes are optional. Correct facts are not.

- Title: same format as commits (`feat: ...`, `fix: ...`).
- One topic per pull request.
- Visual change? Add a screenshot or a GIF, like `demo.gif`.
- Link the issue if there is one (`Closes #12`).

Copy this:

```markdown
# What

One or two sentences: what changes for the person using the extension.

# Why

The problem it fixes, or what it makes easier.

# How to test

1. Steps a human can follow in Firefox.
2. What they should see.

# Notes

Risks, what you could not test, screenshots.

# Final note

One line, in the spirit of the README's final note.
```
