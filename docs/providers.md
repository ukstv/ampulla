# Providers

A provider is anything the container can create and inject. Ampulla supports three kinds: **class providers**, **value providers**, and **factory providers**. You register them in the `providers` array of a `@Module`.


## Class providers

The most common form. Pass a class constructor directly and the container will instantiate it, injecting any dependencies declared with `@Injectable`.

```ts
@Injectable()
class Logger { /* ... */ }

@Injectable(Logger)
class UserService {
  constructor(private readonly logger: Logger) {}
}

@Module({
  providers: [Logger, UserService],
})
class AppModule {}
```

The class is both the token and the implementation. `container.get(UserService)` returns the single instance the container created.

### useClass — decoupling token from implementation

When you want to register a class under a different token — typically an abstract class or an `InjectionToken` representing an interface — use `useClass`:

```ts
import { useClass, injection } from "ampulla";

const ILogger = injection<{ log(msg: string): void }>("ILogger");

@Injectable()
class ConsoleLogger {
  log(msg: string) { console.log(msg); }
}

@Module({
  providers: [useClass(ILogger, ConsoleLogger)],
  exports: [ILogger],
})
class LoggerModule {}
```

Now importers depend on the `ILogger` token, not the `ConsoleLogger` class. You can swap the implementation in tests or different environments without changing any consumer code.


## Value providers

Use `useValue` when the thing you want to inject already exists — a configuration object, a constant, a third-party client instance, a primitive.

```ts
import { useValue, injection } from "ampulla";

const PORT = injection<number>("PORT");
const CONFIG = injection<AppConfig>("CONFIG");

@Module({
  providers: [
    useValue(PORT, 3000),
    useValue(CONFIG, { host: "localhost", db: "myapp" }),
  ],
})
class AppModule {}
```

The container always returns the exact reference you passed. There is no cloning or transformation. This means objects are shared as-is — which is what you want for singletons like config or clients.


## Factory providers

Use `useFactory` when the value needs to be *computed* — constructed from other providers, fetched at startup, or built with logic that doesn't fit in a class constructor.

```ts
import { useFactory, injection } from "ampulla";

const DB_URL = injection<string>("DB_URL");
const DB = injection<DatabaseConnection>("DB");

@Module({
  providers: [
    useValue(DB_URL, "postgres://localhost/app"),
    useFactory(DB, [DB_URL], (url) => createConnection(url)),
  ],
})
class AppModule {}
```

The second argument is the list of dependency tokens to inject. The third argument is the factory function, which receives the resolved dependencies in the same order. Any token in the inject list can be wrapped with `optional()` to receive `undefined` if it is not registered:

```ts
const CACHE = injection<Cache>("CACHE");
const DB = injection<Pool>("DB");

useFactory(DB, [DB_URL, optional(CACHE)], (url, cache?) => {
  const pool = new Pool(url);
  return cache ? new CachedPool(pool, cache) : pool;
})
```

### Async factories

Factories can be async. The container awaits the returned promise before making the value available to any dependent.

```ts
useFactory(DB, [DB_URL], async (url) => {
  const conn = new DatabaseConnection(url);
  await conn.connect();
  return conn;
})
```

All async factories run in parallel where the dependency graph allows it. A factory's dependents wait for it to resolve, but unrelated factories start immediately.

### Combining factory and class providers

A common pattern: use a factory to provide a low-level token, then use a class provider that depends on it.

```ts
const DB = injection<Pool>("DB");

@Injectable(DB)
class UserRepository {
  constructor(private readonly db: Pool) {}
  
  async find(id: number) {
    return this.db.query("SELECT * FROM users WHERE id = $1", [id]);
  }
}

@Module({
  providers: [
    useFactory(DB, [CONFIG], async (config) => new Pool({ connectionString: config.dbUrl })),
    UserRepository,
  ],
  exports: [UserRepository],
})
class DatabaseModule {}
```


## Choosing a provider kind

| Situation | Use |
|---|---|
| A class that takes injected dependencies | Bare class in `providers` |
| A class registered under an abstract token | `useClass(token, implementation)` |
| A config object, constant, or existing instance | `useValue(token, value)` |
| A value computed from other providers | `useFactory(token, inject, fn)` |
| An async resource (DB connection, client pool) | `useFactory` with an async function |
| A dependency that may or may not be registered | `optional(token)` in `@Injectable` or `inject` array |


## One provider per token per module

A single module cannot register the same token twice. Attempting to do so throws `DuplicateProviderError` at startup.

If two different modules happen to provide the same token, there is no conflict: each module's providers are scoped to that module. A consumer sees the token from whichever module is closer in its import chain.
