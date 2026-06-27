# Testing

Ampulla is built with testing in mind. `TestingContainer` gives you a lightweight way to compose providers for a single test without declaring a dedicated test module class. No mock containers, no test modes, no special setup — just the same module system you already know, in one line.

```ts
import { TestingContainer } from "ampulla/testing";
```


## TestingContainer.use — the one-liner

`TestingContainer.use(token, metadata)` creates a module from `metadata`, initializes it, and returns the resolved value for `token`. It is the fastest way to test a single provider in isolation.

```ts
import { describe, it, expect } from "vitest";
import { TestingContainer } from "ampulla/testing";
import { useValue } from "ampulla";
import { UserService } from "./user.service.js";
import { DB_URL } from "./tokens.js";

it("creates a user", async () => {
  const svc = await TestingContainer.use(UserService, {
    providers: [
      useValue(DB_URL, "postgres://localhost/test"),
      UserService,
    ],
  });

  await svc.create("Alice");
  // assert...
});
```


## TestingContainer.fromModule — full container access

When a test needs to inspect multiple providers or call `container.get` more than once, use `fromModule`. It returns a fully-initialized `Container` with the same API as `Container.create`.

```ts
it("resolves all dependencies", async () => {
  const container = await TestingContainer.fromModule({
    providers: [
      useValue(DB_URL, "postgres://localhost/test"),
      Logger,
      UserService,
    ],
  });

  const svc = container.get(UserService);
  const logger = container.get(Logger);

  expect(svc).toBeInstanceOf(UserService);
  expect(logger).toBeInstanceOf(Logger);
});
```


## Overriding providers

The most common testing need: replace a real dependency with a fake. Because `useValue` and `useFactory` are regular providers, overriding is just a matter of swapping them in the `providers` array.

```ts
class FakeMailer {
  sent: string[] = [];
  async send(to: string) { this.sent.push(to); }
}

it("sends a welcome email on signup", async () => {
  const mailer = new FakeMailer();

  const svc = await TestingContainer.use(SignupService, {
    providers: [
      useValue(Mailer, mailer),  // inject the fake directly
      SignupService,
    ],
  });

  await svc.signup("alice@example.com");
  expect(mailer.sent).toContain("alice@example.com");
});
```

Because all providers are singletons per container, the same `mailer` instance that you inspect in the assertion is the one that was injected into `SignupService`.


## Importing real modules

`fromModule` accepts `imports`, just like a real `@Module`. This lets you test a provider in the context of its real dependencies, overriding only what needs to change.

```ts
it("saves to the real schema", async () => {
  const container = await TestingContainer.fromModule({
    imports: [DatabaseModule],          // real database module
    providers: [
      useValue(DB_URL, TEST_DB_URL),   // but override the URL
      UserRepository,
    ],
  });

  const repo = container.get(UserRepository);
  await repo.save({ name: "Alice" });
  // assert against the test database...
});
```


## Testing lifecycle hooks

`TestingContainer` runs the full lifecycle, including `@OnModuleInit` and `@OnModuleDestroy`. If a provider has initialization that must complete before it is usable, it will be completed before `TestingContainer.use` or `fromModule` returns.

To test teardown, call `container.dispose()` explicitly — or use `await using`:

```ts
it("cleans up on dispose", async () => {
  await using container = await TestingContainer.fromModule({
    providers: [DatabaseConnection],
  });

  const conn = container.get(DatabaseConnection);
  expect(conn.isConnected).toBe(true);
  // container.dispose() is called here; onModuleDestroy runs
});
// assert the connection was closed, or trust that onModuleDestroy did its job
```


## Keeping tests fast

A few patterns that keep tests lean:

**Test the smallest possible unit.** Use `TestingContainer.use` for a single provider. Only bring in `imports` when testing real integration.

**Fake non-essential dependencies with `useValue`.** Don't instantiate real HTTP clients, real databases, or real message queues in unit tests. Pass a fake object that implements the same interface.

**One container per test.** Don't share containers between `it` blocks. Each test gets a fresh container, which means fresh instances with clean state.

**Let TypeScript catch injection mistakes.** Because `@Injectable` constrains the class type, a fake that doesn't implement the right interface is a compile error, not a runtime surprise.
