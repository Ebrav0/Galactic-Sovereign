# Public website design QA

## Target and normalization

- Visual target: `exec-cccadadb-4cb5-4dd3-920c-7a427cf2bbbc.png`, the approved centered-beacon direction.
- Implementation: `qa/site-hero-1280x720-final.png` at a 1280 x 720 desktop viewport.
- Comparison: `qa/hero-comparison.png`; the tall target was normalized to the top-aligned 16:9 hero crop and placed beside the implementation.

## Comparison result

- Typography: Orbitron preserves the squared, wide display character and Rajdhani carries the technical supporting copy. The implementation uses a denser two-line title at desktop so the beacon, tagline, and actions remain visible above the fold.
- Layout: the central sigil, eyebrow, headline, subhead, paired actions, horizon, and thin top navigation reproduce the target's hierarchy. The implementation keeps the beacon on the visual center instead of the target's slightly right-weighted galaxy.
- Color and imagery: the final generated galaxy asset retains the navy, cyan, white, and restrained amber palette. The source asset is sharp at desktop and does not show masking artifacts or fabricated UI art.
- Shape and icons: controls use restrained squared corners and Phosphor icons; no handcrafted SVG, CSS illustration, placeholder card art, or emoji substitutes are present.
- Copy: the hero and supporting sections explain the actual grand-strategy game, and the showcase uses a real in-game Dyson-sphere screenshot.

## Responsive and accessibility passes

- Desktop: 1280 x 720 and 1440 x 1000 checked with no horizontal overflow.
- Mobile: 390 x 844 checked. A P1 headline overflow was found in the first pass and fixed by reducing the small-screen display clamp and letter spacing; the final capture is `qa/site-mobile-390x844-fixed.png`.
- Routes: `/`, `/changelog/`, `/privacy/`, and an unknown route all render one semantic `main` region and do not overflow.
- Navigation: Play and Admin point to their production hostnames; changelog and privacy links resolve to their dedicated pages.
- Accessibility: semantic landmarks, visible keyboard focus, descriptive image alt text, practical mobile targets, reduced-motion overrides, and screen-reader labels are present.
- Browser console: no errors or warnings in the final local pass.

## Remaining findings

No open P0, P1, or P2 visual findings after the mobile headline correction.
