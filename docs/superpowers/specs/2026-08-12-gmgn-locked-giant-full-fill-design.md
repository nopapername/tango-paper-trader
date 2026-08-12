# GMGN Locked Giant Quick-Buy Full-Fill Design

**Date:** 2026-08-12

**Status:** Approved for implementation planning

**Scope:** GMGN trench quick-buy presentation only

## Goal

Every Tango paper quick-buy control on a verified GMGN trench card must occupy the complete Tango-owned Giant slot: 100% of the available slot width and exactly 36 px high. Its painted surface, hit target, and outer control must share the same rectangle, with the two-line content centered. Changing GMGN's Small, Large, Extra large, or Giant setting must not change this geometry or any Tango action identity.

## Confirmed Live DOM

The current GMGN trench quick-buy path is:

```text
.BuyButton-continer
  -> retained overflow wrapper
    -> [class~="group/btn"] action host
      -> native [data-testid="quickbuy"] leaf
```

Tango preserves the slot-local wrappers and replaces only the native action leaf. The Tango path is therefore:

```text
.BuyButton-continer.tango-native-buy-overridden
  -> .tango-quick-buy-structural-host (overflow wrapper)
    -> .tango-quick-buy-action-host.tango-quick-buy-structural-host
      -> .tango-list-quick-buy
        -> .tango-quick-buy-content
```

The adapter already discovers the `group/btn` host and marks every continuous ancestor between that host and the verified slot. That structural discovery remains the boundary for layout ownership.

## Root Cause

The current implementation fixes only `.tango-list-quick-buy` to 36 px. The verified slot, overflow wrapper, and action host have only a 36 px minimum height. GMGN retains `!h-full`, fixed-height, padding, alignment, and overflow utility classes on those upstream nodes. When they resolve taller than 36 px, the Tango button remains a centered 36 px strip inside a taller native-owned slot, so its painted surface and hit target do not visually fill the Giant area.

The existing headless gate permits this because it asserts that upstream nodes are at least 36 px and that the paper surface is visible. It does not require the slot, wrapper, host, button, and painted content to have identical rectangles.

## Selected Design

### 1. Own the complete verified slot-local geometry

Within a verified, Tango-overridden `.BuyButton-continer[data-tango-quick-buy="1"]`, Tango will apply one exact layout contract to:

- the slot;
- every adapter-marked `.tango-quick-buy-structural-host` in the continuous slot-local chain;
- the `.tango-quick-buy-action-host`;
- `.tango-list-quick-buy`;
- `.tango-quick-buy-content`.

The slot, retained wrappers, action host, and paper button will each resolve to:

- exact `height`, `min-height`, and `max-height` of 36 px;
- 100% of the slot's available width, with `min-width: 0` and border-box sizing;
- no native padding or margin that can reduce or offset the owned rectangle;
- centered flex alignment with no transform-based displacement;
- no clipping of the 36 px Tango surface.

The card or trench column continues to determine the available horizontal width. Tango does not introduce a fixed pixel width or alter unrelated card geometry.

### 2. Make paint and hit geometry identical

`.tango-list-quick-buy` remains the only interactive paper quick-buy owner. It stays exactly 36 px high and 100% wide. `.tango-quick-buy-content` will stretch deterministically to the button's full border box rather than relying on an indefinite percentage-height chain.

The normal 16% and hover 24% translucent Tango surfaces remain unchanged. The amount text remains 14 px, the Paper hint remains 10 px, and both lines remain horizontally and vertically centered. Inner content remains pointer-inert so every activation belongs to the outer paper button.

### 3. Keep presentation independent from GMGN settings

The adapter continues to stamp `data-tango-quick-buy-size="giant"` and clear native leaf classes and inline styles. It must not infer, cache, observe, or copy GMGN's Small, Large, Extra large, or Giant presentation into Tango.

Later native class/style mutations may trigger the existing structural reconciliation, but they must leave the same replacement node, binding, callback, action ID, nonce, generation, state, and fixed Giant geometry intact. A late or replaced action host receives the structural classes; obsolete hosts have those Tango classes removed through the existing cleanup path.

### 4. Preserve all behavior and safety boundaries

This is a presentation-only correction. It must not change:

- quick-buy amounts or presets;
- token/card identity resolution;
- quotes, supply inference, paper fills, balances, positions, or fees;
- pending, ready, or in-flight semantics;
- isolated-world Guard registration or trusted-click rules;
- native-control restoration and fail-closed behavior;
- any real GMGN trading path.

A permitted activation still produces exactly one paper callback and zero native callbacks.

## Superseded Requirement

This design supersedes only the following geometry clauses in `2026-08-11-gmgn-paper-trade-hardening-and-locked-ui-design.md` and its implementation plan:

- the slot and host have only a 36 px minimum height;
- a taller host remains taller and centers the 36 px replacement inside it;
- tests accept host/slot heights greater than 36 px.

The replacement contract is now stronger: the complete Tango-owned slot-local chain is exactly 36 px high, and the painted surface fills that exact rectangle. All security, action-identity, paper-only, and fixed-Giant requirements from the earlier design remain authoritative.

## Alternatives Considered

### Clamp only the inner overflow and action host

This is less invasive but leaves the outer slot free to retain extra GMGN height or padding. It cannot guarantee that the visible Tango surface fills the complete slot, so it does not meet the approved requirement.

### Replace or bypass the GMGN wrapper subtree

This provides strong layout isolation but interferes with React reconciliation, virtualized card reuse, native restoration, and the existing Guard identity boundary. The adapter already has a safe continuous-wrapper marking mechanism, so replacing the subtree is unnecessary.

## Test-Driven Regression Matrix

Production changes begin only after focused tests demonstrate the current failure.

### Exact live topology

A headless fixture must model the real five-layer path:

```text
slot -> overflow wrapper -> group/btn -> paper button -> painted content
```

It must apply hostile native height, `!h-full`, padding, margin, overflow, alignment, and transform conditions representing 24, 28, 32, 36, 48, and 113 px native settings.

For every case, computed rectangles must prove:

- slot, overflow wrapper, action host, paper button, and painted content are all exactly 36 px high;
- their left, right, top, bottom, and width values match within the browser's sub-pixel tolerance;
- the painted surface is nontransparent across the owned button area;
- amount and Paper text remain centered and unclipped.

### Native mutation isolation

Switching the simulated native presentation through Small, Large, Extra large, Giant, and hostile values must retain:

- the same replacement element and binding;
- `data-tango-quick-buy-size="giant"`;
- the same action ID, binding nonce, generation, and registered callback;
- one paper callback and zero native callbacks after trusted activation.

### Lifecycle cleanup

Late-host insertion, host replacement, virtualized card reuse, native reinsertion, and teardown must prove that structural classes move only along the current verified slot-local chain and are removed from obsolete hosts without touching unrelated card nodes.

### Regression and packaging

The focused adapter, Guard, cross-world, content-structure, and content-runtime suites must pass. The full test suite, extension validation, and build must pass. Generated `dist/tango-paper-trader` runtime assets must match their source counterparts; generated files are not edited by hand.

## Chart Marker Finding (No Change in This Scope)

The detail-page BUY/SELL marker renderer already uses factual marker coordinates, requires a current verified axis mapping, and creates a line only when the projected value is inside the current plot bounds. Out-of-range targets remain hidden rather than clamped to a chart edge. Sparse/stale axes, iframe or viewport generation changes, and worker-only canvases intentionally fail closed until trustworthy current coordinates exist.

The current marker and adapter regression run passed 275 tests, including out-of-plot hiding, in-range reappearance, price/market-cap axis selection, and viewport invalidation. The inspected Chrome detail page had neither the Tango panel nor the marker overlay, showing that the extension was not loaded in that page; therefore it could not serve as a live extension rendering check. No chart production change is included in this design. Final manual chart verification occurs after the rebuilt extension is reloaded.

## Acceptance Criteria

1. Every verified GMGN trench quick-buy shows one Tango-owned Giant surface whose painted area and clickable area fill 100% of the available width and exactly 36 px of height.
2. The complete verified slot-local chain resolves to the same 36 px rectangle, without native padding, alignment, overflow, or transform shrinking or offsetting the surface.
3. Changing GMGN's button-size setting never changes Tango geometry, typography, appearance, action identity, or behavior.
4. Amount and Paper text remain centered and unclipped in normal, hover, focus, pending, ready, and in-flight states.
5. Quick-buy functionality and the isolated paper-only safety boundary remain unchanged: one trusted activation yields one paper callback and zero native callbacks.
6. Chart BUY/SELL lines remain hidden until a factual target enters a trustworthy current visible range; this work introduces no guessed, clamped, or stale chart coordinate.
