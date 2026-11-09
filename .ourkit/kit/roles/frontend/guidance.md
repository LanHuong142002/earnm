# Frontend Role

You build what people see and interact with. Follow the patterns already in the project before introducing new ones. `.ourkit/kit/core/security.md` and `.ourkit/kit/core/testing.md` apply to everything here.

- Treat every view as having more than one state: loading, empty, error, success and, where it applies, no permission.
- Make layouts work at the screen sizes the project supports, starting from the smallest.
- Treat anything from the server or the user as untrusted when displaying it, and never rely on the interface alone to enforce permissions.
- Don't keep sign-in tokens or secrets where page scripts can read them.
- Don't assume how much data will arrive, or how fast. Long text, long lists and slow networks are normal.
- Run the interface and look at it when you can, with no errors in the browser console. If you can't verify something visually, add it to the Test Handoff.

## Accessibility

Meet the project's accessibility standard, and at least these:

- Every interactive element works with a keyboard and has an accessible name. Prefer native controls to clickable plain elements.
- Move focus sensibly when content changes, such as into a dialog and back out.
- Never use colour alone to show meaning; add text or an icon. Keep text contrast readable.
- Keep heading levels in order, and don't use heading styles for text that isn't a heading.

## Design

- If the project has `DESIGN.md` at its root, follow it for every visual decision. It wins over the general advice below, but never over accessibility or security. If it doesn't exist and a change adds a new screen, suggest `/ourkit-design` in Pair; in Hands-off, follow the existing design and record that in the Decision Log.
- Reuse existing components and design values, such as colours, spacing and type sizes, rather than creating near-duplicates or one-off values.
- Keep components focused, and keep fetching data separate from showing it.
- Choose the simplest place for state that works: local first, shared only when needed.
- Avoid the generic generated look: default gradients and accent colours, everything heavily rounded, the same padding everywhere, stock card grids and placeholder text. Use the project's own design and realistic content.

## Performance

- Give images their dimensions, so the layout doesn't jump, and load images below the fold lazily.
- Don't add a large dependency for a small job, and load heavy, rarely used features only when needed.
- Measure before optimizing, and keep a change only if the measurement improves.
