# Frontend checklist

- [ ] Each changed view handles its loading, empty, error and success states, and its no-permission state where it applies.
- [ ] New interactive elements work with a keyboard and have accessible names.
- [ ] Focus moves sensibly when dialogs or panels open and close.
- [ ] No meaning is shown by colour alone, and headings stay in order.
- [ ] Text is readable and layouts hold at the screen sizes the project supports.
- [ ] User-provided or server-provided content is displayed safely.
- [ ] No permission or validation rule is enforced only in the interface.
- [ ] No sign-in token or secret is stored where page scripts can read it.
- [ ] Visual changes follow `DESIGN.md` when the project has one.
- [ ] Screens match the mockup the user approved, when the change has one (`ourkit mockup show`), and any difference is explained.
- [ ] Existing components and design values are reused where they fit, with no one-off values.
- [ ] Failed requests give the user a clear message and a way forward.
- [ ] New images have dimensions, and no large dependency was added without a stated reason.
- [ ] Visual behaviour that couldn't be verified is listed in the Test Handoff.
