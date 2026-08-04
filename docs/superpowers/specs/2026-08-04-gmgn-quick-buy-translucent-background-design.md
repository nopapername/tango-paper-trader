# GMGN Paper Quick-Buy Translucent Background Design

## Goal

Make the virtual quick-buy button on GMGN trench cards translucent so the underlying card information remains visible, without changing any functional behavior.

## Approved Appearance

- Normal background: the existing quick-buy accent color at approximately 38% opacity.
- Hover background: the same accent color at approximately 50% opacity.
- Text, icon, border, and paper badge remain independently rendered and are not faded with whole-element `opacity`.
- Small, large, extra-large, and giant GMGN button sizes use the same background policy.

## Implementation Boundary

Only `src/content/content.css` may change production behavior for this requirement. The canonical `.tango-list-quick-buy` background overrides copied solid or gradient GMGN backgrounds with a semitransparent color. The hover rule changes only that background strength.

The change must not modify:

- Button dimensions, layout, typography, alignment, or hit area.
- DOM creation, replacement, lifecycle, reconciliation, or mutation observers.
- Pointer events, click handlers, quick-buy action IDs, locks, or route binding.
- Native GMGN control hiding or the paper-only safety guard.
- Quotes, supply, balances, positions, trades, fees, PnL, or chart markers.
- Any popup, dashboard, detail panel, or non-quick-buy button style.

## Rejected Alternatives

- Whole-button `opacity` would also fade text and icons and would interact with active/in-flight states.
- A fully transparent, border-only button would maximize visibility but reduce quick-buy recognition and text contrast.
- Preserving arbitrary copied GMGN backgrounds would keep the current inconsistent solid-versus-transparent appearance.

## Verification

- A CSS structure test proves the virtual quick-buy base and hover backgrounds use semitransparent color values.
- The test proves the base rule does not use whole-element `opacity`.
- Existing size, centering, full-hit-area, fail-closed native-control, and paper-action tests remain unchanged and pass.
- Extension validation and the full test suite remain green.

## Safety

This is a visual-only CSS change. It introduces no script, event dispatch, network request, wallet access, signature, approval, swap, transaction construction, or real-funds operation.
