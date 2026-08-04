# GMGN Quick-Buy Maximum-Safe Typography Design

## Goal

Increase the two-line paper quick-buy text as far as the four observed GMGN button heights safely allow, while preserving the exact GMGN slot, card, hit area, and all paper-trading behavior.

## Approved visual contract

The localized paper label remains on the first line and the native-asset amount remains on the second line. The target profiles are:

| GMGN profile | Label | Amount | Available height |
| --- | ---: | ---: | ---: |
| Small | 8px | 11px | 18px |
| Large | 9px | 12px | 20px |
| Extra large | 9px | 13px | 21px |
| Giant | 10px | 14px | 22px |

Both rows use `line-height: 0.9`. The owned content wrapper receives only `2px` horizontal padding and no vertical padding. The existing translucent GMGN-theme background, centered column layout, and localized text remain unchanged.

If Chrome's real glyph bounds show clipping or row overlap for one profile, only that profile is reduced in `0.5px` steps until it reaches the largest passing value. No GMGN-owned geometry may be enlarged to make a target font fit.

## Architecture and scope

Production changes are CSS-only and limited to the Tango-owned quick-buy text wrapper and its four typography variables in `src/content/content.css`, followed by the generated `dist/tango-paper-trader` copy. No production JavaScript changes are permitted.

The outer `.tango-list-quick-buy` remains the sole click owner and continues to fill the existing GMGN slot. The inner `.tango-quick-buy-content`, label, amount, icon, and spans remain pointer-inert. Native GMGN buy controls remain hidden and non-interactive while paper mode is active.

This change must not modify discovery, publication, token identity, quote selection, order amount, balance, position, chain synchronization, navigation, hover/focus/in-flight behavior, or real-funds protection.

## Layout invariants

- GMGN continues to own card, operation-row, host, slot, and button height/width.
- No vertical padding, fixed outer height, minimum outer height, absolute positioning, negative margin, transform scaling, or visible overflow is introduced.
- The wrapper and both text rows stay completely inside the paper button at all four profiles.
- The outer paper hit area and native-control isolation remain byte-for-byte behaviorally unchanged.
- Verification never clicks a real or paper trading control.

## Regression strategy

Before production CSS changes, extend the existing real-Chrome pixel oracle so the new target fonts and `2px` horizontal padding fail against the current smaller implementation. The fixture must inspect both direct and nested GMGN geometries for all four profiles.

For every profile, the browser test must prove:

- the label and amount have the expected computed font sizes and line height;
- the visible glyph ink of each row stays inside the wrapper;
- the two rows' actual ink masks do not overlap;
- horizontal text is not clipped;
- the wrapper remains inside and equal to the existing paper hit area;
- slot, host, card, and following-card geometry are unchanged;
- inner text remains pointer-inert, the paper button remains clickable, and the native button remains hidden and non-interactive.

After the focused red-green cycle, run the complete test suite, extension validation, build, source/dist SHA-256 parity check, and a scoped diff review. Any non-typography behavior change is a regression and blocks delivery.
