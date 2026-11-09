# Testing

Tests are how a change proves it works. "It looks right" is not done. These rules apply to every Role and every Stage that writes or judges code. Run tests only through `ourkit gate run test`, so the project's own command from the Stack Profile is used.

## Write the test first

- For new behaviour, write a test that fails, run it and see it fail, then write the least code that makes it pass. Then tidy the code while the tests stay green.
- A test that passes the first time it runs proves nothing yet. Check that it fails without your change.
- For a bug, reproduce it with a failing test before touching the code, then show the same test passing after the fix. A reproduction written without knowing the fix is stronger, so delegate it to a separate subagent when the bug isn't trivial.
- Changes with no behaviour, such as docs, comments or plain configuration, don't need a test.

## Write tests worth keeping

- Check what the code does, its result or state, not which internal calls it made. A test that breaks on a refactor with no change in behaviour is testing the wrong thing.
- Prefer the real code. Use, in order: the real thing, a fake that works in memory, a stub that returns fixed data, and a mock that checks calls only as a last resort, for things that are slow, unpredictable or have outside effects.
- Make most tests small and fast, with no network or shared state. Keep the few slow end-to-end tests for the paths that matter most.
- Each test sets up its own state and passes alone or in any order. A test that fails sometimes is a bug, not bad luck.
- Name each test after the behaviour it checks, so a failure reads like a broken requirement.
- Let each test read on its own. Some repetition is fine when it makes a test clear without jumping to helpers.

## Never make the suite green by weakening it

- Never skip, disable or delete a test, or loosen what it checks, to get a pass. If a test is truly wrong, say why in the change.
- "All tests pass" means nothing if no tests ran. Report `not-run` as not run (see `.ourkit/kit/core/gate.md`).
- Running the same tests again on unchanged code adds nothing. Run them again after a change.

## Excuses to reject

| Excuse | Answer |
|---|---|
| "I'll add tests once it works." | Tests written afterwards check what the code does, not what it should do. |
| "It's too simple to test." | Simple code grows. The test records what was meant. |
| "I checked it by hand." | A manual check doesn't run again next time. Put it in a test, or in the Test Handoff if it can't be automated. |
| "The test is flaky, so I skipped it." | Flaky means broken. Fix it or report it as blocked. |
