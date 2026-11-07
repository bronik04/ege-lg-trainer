# New Round Navigation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; implement inline. Steps use checkbox syntax for tracking.

**Goal:** Make the unanswered-only mode discoverable and add a home action to results.

**Architecture:** Reuse existing state filtering and storage. Replace the buried select with shared accessible radio chips before the task filters; reuse existing chip styles and hash navigation.

**Tech Stack:** Vanilla JavaScript, Python static build, Node tests, Playwright/Chrome.

**Spec:** `docs/superpowers/specs/2026-11-07-new-round-navigation-design.md`

## Global Constraints

- Preserve existing progress and teacher links; no data or token changes.
- Home is `#/rules`; returning home must preserve results.
- Work in the current checkout to retain the author's in-progress question bank changes.
- No agent launches: repository instructions require the author's consent per launch.
- Leave changes reviewable in the working tree; no publishing or unrelated commits.

## Review Focus

- Correct and incorrect attempts both exclude a question from new selections.
- Empty selections must not silently include previously answered questions.
- Saved filters must survive reload and work with task/source restrictions.
- Practice and tones share accessible controls without sharing their saved filters.
- Home navigation must preserve results and remain usable on narrow screens.

### Task 1: Discoverable round modes and result navigation

**Files:** `src/app.js`, `src/app.css`, `test/ui.test.mjs`, `CHANGELOG.md`.

**Interfaces:** Consumes existing `filterQuestions`, `filterToneWords`, saved `filters.state`
and `toneFilters.state`. Produces `roundStateControl(legend, state, onChange)` DOM fieldset.

- [x] Add browser coverage for visible early mode controls, unanswered-only selection,
  persistence, exhaustion and home navigation without losing the finished round.
- [x] Run targeted tests and observe failures caused by the missing UI.
- [x] Replace selects with shared radio controls above other filters; add mode explanations,
  precise empty messages and result home links. Update existing UI tests to operate radios.
- [x] Run targeted tests, full `npm test`, `npm run build`, and inspect mobile/desktop renders.
- [x] Review the diff and record the user-facing change in `CHANGELOG.md`.

## Execution notes

- Baseline: 199 Python tests and 140 Node/browser tests passed.
- Three new integration tests failed against the missing controls/home links, then passed.
- Mobile layout assertion failed with two narrow columns at 390 px, then passed with the
  existing 720 px mobile breakpoint. No horizontal overflow at 320, 390 or 1100 px.
- Inspected light desktop, dark mobile and the result screen using the built real bank.
  Hover contrast of selected modes is above 15:1 in both themes after the scoped fix.
- Self-review: filtering and storage remain unchanged; teacher URLs remain compatible;
  new controls preserve keyed focus. No agents launched under the repository's consent rule.
- The design detector reported three existing side-border warnings on unchanged CSS lines;
  none apply to the added controls.
- Final verification: `npm test` passed all 199 Python and 143 Node/browser tests (no skips);
  `npm run build` succeeded. Arrow-key switching retains focus across rerenders.
