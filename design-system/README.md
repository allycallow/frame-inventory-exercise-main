# Frame Inventory Design System

## Overview

The design system supports the Frame Inventory prototype for out-of-home media operations. It builds on the Global Design System’s Global Next theme with Inter typography and a blue and cyan palette. It adds inventory tables, master data drawers, audit timelines and a step-by-step creation flow.

The [design skill](./SKILL.md) describes how to reuse these patterns. The HTML cards in `preview/` show individual design tokens and components.

## Interface

- Open [Frame Inventory.html](./Frame%20Inventory.html) for the prototype. It loads React, ReactDOM and Babel from a CDN, then local JSX scripts and CSS. `App` mounts into `#root`. `[Frame Inventory.html:script]` `[app.jsx:App]`
- Load `tokens.css` before `styles.css`. The first defines fonts, color, typography, spacing and elevation. The second styles the shell, buttons, fields, inventory tables, chips and timelines. `[tokens.css::root]` `[styles.css:.app]` `[styles.css:.btn]` `[styles.css:.field]` `[styles.css:.tbl]` `[styles.css:.chip]` `[styles.css:.timeline]`
- `window.FRAME_DATA` exposes sample frames, status metadata, fixture-derived filter options and map pin positions. The shell exposes shared browser components including `Icon`, `Rail`, `Topbar`, `FrameMap`, `Timeline` and `ExternalIdsTable`. `[data.jsx:window.FRAME_DATA]` `[shell.jsx:Object.assign]`
- Direction A offers a filter sidebar and table or map, with separate detail and edit screens and a history tab. Its text search includes external ID values. Direction B keeps a searchable, site-filtered list beside a pane that switches between map, detail, edit and history. `[direction-a.jsx:DirA]` `[direction-a.jsx:DirA_Search]` `[direction-a.jsx:DirA_Detail]` `[direction-b.jsx:DirB]`
- The new frame wizard has five steps from Basics through Review. The master data rail opens regions and towns, site types, formats and external ID systems via `md-regions`, `md-sites`, `md-formats` and `md-extids`. `[master-data.jsx:NewFrameScreen]` `[master-data.jsx:MD_CONTENT]` `[shell.jsx:Rail]`

## Invariants

- The app starts in Direction A with comfortable density and the search screen. Switching direction returns to the frame search screen. Shortcuts 1–4 select screens and A/B selects direction when focus is outside inputs, textareas and selects. `[app.jsx:DEFAULT_TWEAKS]` `[app.jsx:App]`
- Both directions initialize selection to `FRM-00214` and fall back to the first fixture if the selection cannot be resolved. Direction A uses the same filtered results for its table and map. Direction B retains its list controls while switching panes. `[direction-a.jsx:DirA]` `[direction-a.jsx:DirA_Search]` `[direction-b.jsx:DirB]`
- The wizard starts with `draft` status and the first region, site type and technology from `window.FRAME_DATA`. `[master-data.jsx:NewFrameScreen]`

## Side Effects

- Script initialization fills empty fixture histories with sample events and publishes the shared data and components as browser globals. `[data.jsx:FRAMES.forEach]` `[data.jsx:window.FRAME_DATA]` `[shell.jsx:Object.assign]` `[direction-a.jsx:window.DirA]` `[direction-b.jsx:window.DirB]` `[master-data.jsx:Object.assign]`
- Frame edit Save changes and Cancel both return to detail. Save as draft and the external ID link, edit and unlink controls have no handlers. These controls leave the fixture records and history unchanged. `[direction-a.jsx:DirA_Edit]` `[direction-b.jsx:DirB_Edit]` `[direction-b.jsx:DirB]` `[shell.jsx:ExternalIdsTable]`
- Create frame passes the in-memory draft to `onCreate(draft)`. The app returns to the frame section without adding a record. Master data Create and Save changes only close the drawer. Delete has no handler. `[master-data.jsx:NewFrameScreen]` `[master-data.jsx:MDDrawer]` `[master-data.jsx:MasterDataScreen]` `[app.jsx:App]`
- Tweak changes update React state, send `__edit_mode_set_keys` to the parent window and dispatch `tweakchange` in the current window. The panel listens for host activation and deactivation, reads `deck-stage.railVisible` from local storage, and sends `__deck_rail_visible` to the current window when toggled. These hooks make no local storage writes. `[tweaks-panel.jsx:useTweaks]` `[tweaks-panel.jsx:TweaksPanel]`

## Verification

Run this command from the repository root.

```sh
python3 -m http.server 8000 --directory design-system
```

Open [the local prototype](http://localhost:8000/Frame%20Inventory.html) in a browser that can reach the CDN scripts. Use the A/B controls to switch directions, filter the frames, and open a frame from the list and map. Open the edit screen and confirm that Save changes returns to detail with the fixture values. Complete the New frame wizard and open a master data drawer to check that Create returns to the existing fixture view.

## Content fundamentals

- Use a factual, operational tone and second person where an action is required. Examples include “Add a frame” and “Pick from master data”.
- Use sentence case for buttons, headings and columns. Keep acronyms such as OOH, CMS and DSP uppercase.
- Keep labels short and put longer help below them in `--text-secondary`. Prefer inline help.
- Keep product surfaces free of emoji. Use dots and chips for status.
- Give numbers context, such as `412 m`, `10s · 6/min` and `FRM-00214`. Use a middle dot to separate related details.

## Visual foundations

- Use the Inter type scale. Body copy defaults to `--fs-body2` (14px), with 13px for dense UI elements. Use weights 500–600 to distinguish headings.
- Use `--blue-1000` (#046AC4) for primary actions. Use near-white and cool neutrals for the canvas, with green, red and orange for status.
- Place white cards on the near-white canvas. Use 1px `--border-subtle` borders on resting surfaces and `--border-default` on inputs. Reserve elevation for popovers and drawers.
- Use `--radius` (4px) for inputs and buttons, `--radius-lg` (8px) for surfaces, and `--radius-pill` (999px) for chips and pills.
- Use an 8px spacing base. Use `--sp-2` or `--sp-3` for typical gaps of 16px or 24px.
- Use a subtle tint on hover and a darker tint when pressed. Keep control dimensions steady and reserve motion for state changes.
- Keep app chrome focused on text and data.

## Iconography

Use the inline SVGs in `shell.jsx` as the reference for new glyphs. Use a 1.8px stroke, round caps and joins, and `currentColor`. Size domain glyphs at 16–24px. `[shell.jsx:Icon]` `[shell.jsx:SiteIcon]`

- Actions and navigation include `search`, `plus`, `pencil`, `trash`, `chev`, `chevL`, `filter`, `download`, `upload`, `map`, `list`, `pin`, `history`, `more`, `link`, `warn`, `info`, `check` and `x`.
- Domain glyphs include `station`, `road`, `airport`, `mall`, `bus`, `frame`, `dash`, `cog`, `report`, `school` and `globe`.

## Caveats

The system covers Frame Inventory operational screens. Marketing surfaces and dark mode are outside its scope.

`tokens.css` loads local TrueType Inter files at weights 400, 500, 600 and 700. Keep the relative `fonts/` paths when reusing the stylesheet. The font stack falls back to the platform sans serif and Arial. `[tokens.css:@font-face]` `[tokens.css:--font-sans]`
