# GMGN Trench Paper Quick-Buy Live Size Sync Design

**Date:** 2026-08-04  
**Status:** Approved in conversation; awaiting written-spec review  
**Scope:** UI-only correction to the existing protected GMGN trench paper quick-buy control

## Goal

Make every trench paper quick-buy control follow GMGN's Small, Large, Extra large, and Giant button settings immediately, including newly inserted meme cards, while correcting clipping and layered styling defects.

## Non-Negotiable Safety Boundary

- Change only presentation-profile detection, presentation observation, and scoped quick-buy CSS.
- Do not change action IDs, binding nonces, adapter generations, click handlers, quote selection, Engine calls, balances, positions, orders, markers, or storage.
- Preserve the full-slot paper hit target and every NativeQuickBuyGuard rule.
- Never click, dispatch to, reveal, or call a GMGN native trading control.
- A paper activation must continue to produce one paper callback and zero native capture/bubble callbacks.
- Do not add wallet, signature, approval, swap, RPC, network, or permission capabilities.
- Preserve all existing staged and unstaged work.

## Confirmed Causes

### Detached presentation source

The adapter normally removes or replaces GMGN's native quick-buy leaf, then continues reading its size profile from that detached node. GMGN applies later size-setting changes to connected slot or action-host nodes, so the cached paper profile remains stale even when the page visibly changes.

The current ResizeObserver observes some connected geometry, but its callback still re-reads the detached presentation source. Existing tests mutate the detached leaf itself and therefore do not model the live page.

### Ancestor clipping

The owned inner paper surface uses the canonical 24/28/32/36 px heights, but its slot, action host, and full-slot outer control can remain shorter with `overflow: hidden`. This clips larger profiles so Small, Large, and Extra large look nearly identical. The inner surface also lacks shrink, overflow, and radius ownership, producing mismatched outer borders and rectangular color bands.

## Selected Design

### Separate visual presentation from size profile

Native color, border, radius, outline, and shadow presentation continues through the existing trusted presentation path. Connected hosts are never copied onto the paper replacement and cannot contribute layout, action, identity, pointer, visibility, or positioning attributes.

Size detection becomes a separate read-only path with this priority:

1. a newly connected native leaf belonging to the same slot;
2. a connected action host belonging to the same slot;
3. the connected slot or a narrowly bounded connected ancestor between the replacement and slot;
4. the last verified same-chain canonical profile;
5. the existing Large fallback.

Only exact canonical signals are accepted:

| GMGN setting | Height | Text |
| --- | ---: | ---: |
| Small | 24 px | 12 px |
| Large | 28 px | 13 px |
| Extra large | 32 px | 14 px |
| Giant | 36 px | 16 px |

Arbitrary rectangles or values such as 18, 64, or 100 px do not select a profile. Host classes, inline styles, IDs, test IDs, links, roles, and event attributes are never copied to the paper control.

### Observe connected size hosts

The adapter observes only `class` and `style` changes on the current connected size hosts. Resize observation includes the same current hosts as a missed-mutation recovery path. Host replacement refreshes the observation set and disconnects obsolete observers.

A host-size change calls only the profile application path: it updates the paper control's size dataset and CSS variables, refreshes the verified profile cache, and propagates that canonical profile to same-chain trench controls and later cards. It does not recreate the replacement or re-register a new action identity.

The health probe compares the connected canonical profile with the binding profile so a missed mutation is repaired without a broad document scan.

### Prevent clipping without changing hit testing

The full-slot outer paper control remains `width: 100%`, `height: 100%`, and `pointer-events: auto`. Native controls remain non-interactive under the existing safety stylesheet.

The applied canonical height is also exposed to the bound slot. Scoped CSS gives the slot, connected action host, and outer paper control a minimum height equal to that profile while retaining their current overflow containment. The inner surface remains the only semi-transparent painted layer and gains only:

- `box-sizing: border-box`;
- `min-width: 0`;
- shrinkable flex sizing;
- `overflow: hidden`;
- inherited border radius.

These rules make all four visible heights distinct, keep the Paper hint and amount centered, and prevent horizontal or radius mismatch without reducing or moving the click area.

## Update Flow

1. GMGN changes its button-size setting or inserts a new meme card.
2. A slot-local observer reads the current connected canonical size signal.
3. The adapter updates only the existing replacement's profile dataset and CSS variables plus the slot-scoped height variable.
4. Scoped CSS expands the protected slot enough to display the entire owned surface.
5. Existing action identity, guard registration, handler, paper state, quote, and order flow remain unchanged.

If no connected canonical signal exists, the last verified same-chain profile is retained. Invalid or hostile host values are ignored rather than guessed.

## Test-Driven Regression Matrix

Production changes begin only after focused tests reproduce the stale-host and clipping failures.

### Live profile behavior

- Start with a detached Giant native leaf while its connected host changes through Small, Large, Extra large, and Giant; assert immediate `24/28/32/36` and `12/13/14/16` updates.
- Assert a newly connected native leaf outranks a host, while a connected host outranks a stale detached leaf.
- Assert new cards and same-chain peer columns inherit the latest verified profile without copying another column's visual colors or borders.
- Assert replaced hosts are observed and obsolete-host mutations have no effect.
- Assert arbitrary or hostile sizes and action attributes neither change the profile nor enter the paper element.

### Layout behavior

- With an initially undersized hostile slot, assert slot, host, and outer control expose the full canonical height for all four profiles.
- Assert the inner surface is not vertically clipped, fits horizontally, inherits radius, and remains the only painted semi-transparent layer.
- Assert the Paper hint and amount remain centered and visible at every profile.

### Existing behavior preservation

- Replacement element identity, binding object, action ID, binding nonce, generation, handler, paper state, and Guard trust remain identical across every size change.
- Full-slot paper hit testing remains enabled; protected native controls remain hidden and non-interactive.
- A permitted activation produces exactly one paper callback and zero native callbacks.
- Existing quick-buy world integration, safety cascade, content structure, adapter, validator, and build/package-integrity suites continue to pass.

## Acceptance Criteria

1. Switching GMGN among Small, Large, Extra large, and Giant changes existing paper controls immediately and visibly.
2. Newly created meme cards use the current GMGN size on their first protected render.
3. The button surface, Paper hint, amount, radius, and semi-transparent theme styling are centered, unclipped, and consistent.
4. No trading, quote, position, marker, chain, onboarding, shortcut, enable/disable, or Dashboard behavior changes.
5. No native GMGN transaction callback or real-funds capability can be reached by the paper control.
