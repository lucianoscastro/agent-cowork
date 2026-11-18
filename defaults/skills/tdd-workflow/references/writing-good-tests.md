# Writing Good Tests

Read this before writing or changing a test, a mock or a test helper.

A test earns its place by failing when the code breaks. Two rules drive everything below: every test names the break it catches, and every test exercises the real code. A test written first and watched failing against real code already proves both.

## Name the break

Before writing the test body, name the production change that would make it fail, and check that the change is a bug, not a decision.

| You can name... | Then |
|---|---|
| Nothing | Redesign the test around an observable behavior. |
| "The source text changed" | Run the script, config or code and assert its effects. |
| Only intentional decisions | It is a change detector: test the behavior that depends on the decision instead. |

- **Derive expected values by hand.** Literal values and hand-checked fixtures; table-driven tests with literal expected values are the preferred shape. An expected value computed by the code under test, or by its helpers, passes whatever that code does:

  ```typescript
  // Wrong: the same builder computes both sides, so it is always true
  expect(buildSearchQuery({ tag: 'urgent' })).toBe(buildSearchQuery({ tag: 'urgent' }));

  // Right: a literal derived by hand
  expect(buildSearchQuery({ tag: 'urgent' })).toBe('tag:"urgent"');
  ```

- **No change detectors.** A test that only an intentional change can fail (a constant's value, exact message wording, private structure) fires on every redesign and sleeps through bugs. Not `expect(MAX_RETRIES).toBe(5)`, but "a failing call is retried 5 times and the 6th attempt never happens".
- **Behavior, not text.** A test that greps a script, config or document for a line proves only that the source is the source. Run it on controlled inputs and assert outputs, side effects or exit codes.
- **Your code, not the framework.** Test the contract at your boundaries: the route you register, the query you emit, the payload you produce. That the router calls a registered handler is the framework's test. Constructors, getters, constants and plain forwarding earn a test only when they validate, normalize, default, derive or cause a side effect.

## Exercise the real code

- **A mock earns no assertions.** An assertion on a mock passes when the mock is there and fails when it is not; it says nothing about the component. Assert the real behavior, or remove the mock.

  ```typescript
  // Right: real behavior
  expect(screen.getByRole('navigation')).toBeInTheDocument();

  // Wrong: the mock's existence
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
  ```

- **Mock at the right level.** List the real method's side effects before replacing it. Mock the slow or external level below what the test depends on, and keep the rest real. A mock that swallows a write the code reads later makes the test pass while the feature is broken.
- **Make doubles specific.** When arguments, call counts or order are part of the contract, assert them. Give each branch (success, error, malformed) its own fixture, so the wrong branch cannot satisfy the test.
- **Mirror real data completely.** A mocked response has every documented field, not only the ones the test reads; a partial mock passes while the code downstream breaks on the missing field.
- **Production code carries production methods only.** Cleanup or reset that only tests call lives in test utilities, never as a method on the production class.
- **Prefer real components to complex mocks.** When the mock setup is larger than the test, switch to an integration test with the real components.

## Watch it fail

- Run the new test before the change: it fails on an assertion, for the reason you named. An import error, a typo or broken setup is not a failure.
- A test that passes at once tests what already exists. Fix the test, not the code.
- For a regression test: run it with the fix (it passes), revert the fix (it must fail), restore the fix.
- Before finishing, run the repository's whole test command, not only your file, and report any failure by name, including one you did not cause.

## The mutation check

Before finishing, mutate the production code in your head. At least one test fails for each realistic mutation:

- a wrong constant or argument;
- the wrong branch taken;
- a missing state change or side effect;
- an empty or default return;
- missing validation for zero, empty, null, unauthorized or malformed input.

A mutation no test catches is behavior nothing protects, or a test that cannot fail.

## Warning signs

- Setup and assertion share the same object, so they are always equal.
- The test can fail only through a crash or a missing selector.
- The test fails on every intentional change and never on an accidental one.
- Expected values are hidden behind loops, builders or helpers.
- The test greps source text, or asserts that a removed symbol stays removed.
- The test exists for coverage and checks no outcome or side effect.
- An assertion checks a `*-mock` test id, or fails when the mock is removed.
- A method is called only from test files.
- Mock setup is more than half the test, or nobody can say why the mock is needed.

Adapted from the `test-driven-development` skill and its `writing-good-tests.md` in Jesse Vincent's [superpowers](https://github.com/obra/superpowers) (MIT License).
