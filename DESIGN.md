---
name: earnm
description: A tool for a small group of friends planning a drinks shop together. It's warm and orange, compact, light on the screen, and works in light and dark mode.
colors:
  light:
    background: "#FFFFFF"
    surface: "#FFFFFF"          # cards, with border
    field: "#F3F4F6"            # inputs and search
    tile: "#FFF1EB"             # icon tiles and soft orange chips
    border: "#EEEEEE"
    text: "#141414"
    textSecondary: "#5F5F5F"
    placeholder: "#6B6B6B"
    accent: "#F4511E"           # icons, large text (20px+ bold), progress
    accentStrong: "#C2410C"     # buttons, links, any small orange text
    onAccent: "#FFFFFF"         # text on accentStrong
    danger: "#B3261E"
    dangerBg: "#FDF0EF"
    success: "#1E7F4F"
  dark:
    background: "#121212"
    surface: "#1C1C1C"
    field: "#1E1E1E"
    tile: "#2A1A14"
    border: "#2A2A2A"
    text: "#F2F2F2"
    textSecondary: "#A3A3A3"
    placeholder: "#8F8F8F"
    accent: "#F4511E"
    accentStrong: "#F4511E"     # orange is light enough on dark
    onAccent: "#141414"         # dark text on orange buttons
    danger: "#F2B8B5"
    dangerBg: "#3A1715"
    success: "#6FCF97"
  heroGradient: ["#C2410C", "#7A2A12"]   # 135deg, white text only, both modes; start darkened so small white text passes 4.5:1
  projectColors: ["#7C3AED", "#0F766E", "#B45309", "#BE185D", "#1D4ED8", "#15803D"]  # identity only: avatar + card stripe, white text on each >= 5:1
typography:
  family: "Plus Jakarta Sans"   # bundled with the app, weights 400, 600, 800 only
  screenTitle: { size: 24, weight: 800, lineHeight: 30 }
  sectionTitle: { size: 17, weight: 800, lineHeight: 22 }
  body: { size: 15, weight: 400, lineHeight: 21 }
  bodyStrong: { size: 15, weight: 600, lineHeight: 21 }
  label: { size: 13, weight: 600, lineHeight: 18 }
  caption: { size: 12, weight: 400, lineHeight: 16 }
  overline: { size: 10, weight: 800, letterSpacing: 0.8, uppercase: true }
spacing: [4, 8, 12, 16, 20, 24, 32]
layout:
  screenPadding: 20
  sectionGap: 24
  controlHeight: 44
radius:
  avatar: 12
  field: 12
  button: 12
  tile: 14
  card: 16
  checkbox: 6
shadow: none
motion:
  enter: { duration: 300, translateY: 8, stagger: 40, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
  press: { duration: 120, scale: 0.97 }
  shake: { duration: 300, distance: 4 }
  progress: { duration: 250 }
disabled:
  opacity: 0.5                # disabled tiles and controls, always with a text label saying why
header:
  backInset: 4                # extra left inset so the back chevron lines up with screenPadding
---

# earnm design

A small, warm tool. Orange is the one accent. Rounded corners, bold short headings and a lot of empty space. **Keep it small and quiet: a screen should never feel full.**

## Density

- Content sits at the top of the screen with `screenPadding` on both sides. Don't stretch or space things out to fill the height. Only a form's main button may sit at the bottom.
- Show at most three sections before the first scroll, and at most one hero card per screen.
- A list on an overview screen shows up to 5 items, followed by an orange "Xem tất cả" / "See all" link.
- Use `sectionGap` between sections and 8–12 inside them. When in doubt, remove an element rather than shrink it.
- Follow Decision 10: compact vertical flows, sections that collapse and start closed, and no tables.

## Components

- **Primary button:** `controlHeight`, `radius.button`, `accentStrong` fill, `onAccent` text in `bodyStrong`, full width on forms. One per screen.
- **Secondary button:** same size, `field` fill, `text` colour. A destructive action like sign-out uses `danger` text on `field`.
- **Text link:** `label` or `bodyStrong` in `accentStrong`, with at least 44px of touch area.
- **Field:** `controlHeight`, `radius.field`, `field` fill, no border, a 20px leading icon in `placeholder`, and the label above it in `label`. Focused, it gets a 1.5px `accent` border. With an error, it gets a 1.5px `danger` border on `dangerBg`, plus a message below with an alert icon.
- **Card:** `surface`, a 1px `border`, `radius.card`, 12–16 padding. Use list rows inside cards, not cards inside cards.
- **Hero card:** `heroGradient`, `radius.card`, 16 padding, white text (title at least 20/800). Use it only for the one most important thing on a screen: a key number, or on Home the current project.
- **Project identity:** each project gets one of `projectColors`, picked from its id so it never changes and needs no field. It shows as a 40×40 `radius.avatar` avatar with the project's initials (up to 2 letters, `bodyStrong`, white) and as a 4px stripe on the left edge of its card. Identity colours are decoration: never on buttons, links, icons or status, and the name is always shown next to them.
- **Project card (list):** a Card with the stripe and avatar, the name in `bodyStrong`, and a row of chips below it: currency (`VND` / `USD`) and, for Members, the role. A chevron in `textSecondary` on the right. One card per project, 12 apart.
- **Chip:** `caption` weight 600 on `tile` fill in `accentStrong`, 6×10 padding, `radius.button`. Text, never colour alone.
- **Icon tile:** 52×48, `radius.tile`, `tile` fill, a 22px `accent` icon, with a `label` caption below. Show at most 4 in a row. A tile for an area that isn't built yet uses `disabled.opacity` and a "Sắp có" / "Coming soon" caption.
- **Header back:** the platform chevron at `iconSize.md`, inset by `header.backInset` so it lines up with `screenPadding`, with a 44×44 touch area and an accessible label.
- **Section header:** `sectionTitle` on the left, an optional "see all" link on the right. An `overline` in `accent` is allowed above the current project name.
- **Choice (radio or checkbox):** a row inside a card. The selected row shows a ✓ icon in `accent`, never colour alone. A checkbox is 20px, `radius.checkbox`, and filled `accent` with an `onAccent` tick when done. Done text uses `textSecondary` with a line through it.
- **Icons:** one outline icon set, 20–22px, in `accent` or `textSecondary`.

## States

- **Loading:** show the screen's layout as `field`-coloured blocks with the same radii, never a full-screen spinner. Inside a button, a small spinner replaces the label, and the button ignores taps until the request finishes.
- **Empty:** a short invitation of one heading and one line, plus one secondary button. No illustration needed.
- **Error:** say what happened and what to do, in the user's language. Field errors go under the field. Screen errors go in a `dangerBg` card with a retry button. Never show raw error text.
- **Success:** a short confirmation in `success` with a check icon, or simply the updated content. No pop-up for routine saves.
- **Offline:** a small `textSecondary` note at the top ("Đang ngoại tuyến" / "Offline"). The content stays usable.

## Motion

Use `react-native-reanimated`, which the app already has.

| What | When | Spec |
|---|---|---|
| Fade in and rise | A screen opens; sections appear in order | `motion.enter` |
| Staggered list | Project cards appear one after another when the list opens (first 8 only) | `motion.enter` with `stagger` |
| Press | Buttons, cards, tiles, rows | `motion.press` |
| Shake and fade in a message | Wrong password or invalid input | `motion.shake` on the field |
| Progress | A bar or count changes | `motion.progress` |

- When iOS **Reduce Motion** is on, use fades only, with no rise, scale or shake.
- Motion is never the only signal. An error also shows text, and a change also shows the new value.
- Nothing loops or moves on its own, and there's no motion while scrolling.

## Accessibility

- Text pairs above meet at least 4.5:1, and large text at least 3:1. Small orange text in light mode always uses `accentStrong`, never `accent`.
- Touch targets are at least 44×44. Every icon-only control has an accessible label.
- Support Dynamic Type up to the largest standard size: layouts wrap rather than cut text off.

## Screens

The app is iPhone only, in portrait, and must work from 375pt wide (iPhone SE) to 430pt (Pro Max). Respect the safe areas and the home indicator.

## Avoid

- Filling the screen: big banners, stacked heroes, grids of more than 4 tiles, and long lists on overview screens
- Neon, glow, glassmorphism, blur, drop shadows, and gradients anywhere other than the one hero card
- A second accent colour for actions (no gold, no cyan), and colour as the only sign of meaning. Project identity colours are the one exception, and only as decoration
- Delivery-app furniture: location pickers, promo banners, ratings, "HOT" badges and floating centre buttons
- Placeholder copy, stock photos and emoji in place of icons
- Hard-coded colours or sizes in components: use these tokens
- Fonts loaded from the web at run time: Plus Jakarta Sans ships inside the app
