# Hono Adapter

Ampulla's Hono adapter turns your DI-managed classes into Hono routes. Import from `ampulla/hono`.

```ts
import { Controller, Get, Post, Extract, UseMiddleware, registerControllers } from "ampulla/hono";
import { query, param, json } from "ampulla/hono";
```


## The pattern at a glance

```ts
import { Hono } from "hono";
import { Container } from "ampulla";
import { registerControllers } from "ampulla/hono";

import { AppModule } from "./app.module.js";

const app = new Hono();
const container = await Container.create(AppModule);

registerControllers(app, container);

export default app;
```

`registerControllers` iterates the container, finds every class decorated with `@Controller`, and registers its routes on the Hono app. Providers without `@Controller` metadata are silently ignored.


## @Controller and HTTP method decorators

`@Controller(prefix)` marks a class as a controller and sets the route prefix. The prefix defaults to `""` (empty string, routes at root).

Each route handler is a method decorated with one of the HTTP verb decorators:

```ts
import { Injectable } from "ampulla";
import { Controller, Get, Post, Delete } from "ampulla/hono";
import type { Context } from "hono";

@Controller("users")
@Injectable()
class UserController {
  @Get()
  list(c: Context) {
    return c.json([]);
  }

  @Get(":id")
  getOne(c: Context) {
    return c.json({ id: c.req.param("id") });
  }

  @Post()
  create(c: Context) {
    return c.json({ created: true }, 201);
  }

  @Delete(":id")
  remove(c: Context) {
    return c.json({ deleted: true });
  }
}
```

**Path joining rules:**
- `@Controller("users")` + `@Get(":id")` → `/users/:id`
- Leading slashes on method paths are tolerated: `@Get("/search")` and `@Get("search")` both work
- An empty method path registers at the controller prefix: `@Controller("users")` + `@Get()` → `/users`
- Both empty → root: `@Controller()` + `@Get()` → `/`

**Why both `@Controller` and `@Injectable`?**
They are intentionally separate because they do different things. `@Injectable` is a DI primitive: it tells the container what dependencies to inject into the constructor. `@Controller` is a routing primitive: it tells `registerControllers` what URL prefix this class owns. Neither implies the other.

A controller with no dependencies doesn't need `@Injectable` at all. A service with dependencies is `@Injectable` but never `@Controller`. The decorators compose when you need both, and stay out of the way when you don't. This is the same reason `@Tagged` is a separate decorator rather than an argument to `@Controller` — each piece does one thing, and you mix them as your situation requires.

**Decorator order matters.** Class decorators run bottom-to-top in the modern JavaScript decorator spec. `@Controller` must appear *above* `@Injectable` in source so that it runs *after* — it needs to scan the prototype for routes that the HTTP verb decorators have already registered.

```ts
@Controller("users")   // runs second — scans prototype for routes
@Injectable()          // runs first — stores DI metadata
class UserController { ... }
```

Available verbs: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Query` (RFC 10008).


## @Extract — handler ergonomics

By default, route handlers receive the raw Hono `Context`. `@Extract` lets you declare what the handler actually needs, and the adapter extracts it before calling the handler.

```ts
import { Get, Extract, param, query } from "ampulla/hono";

@Get(":id")
@Extract(param("id"))
async getUser(id: string | undefined) {
  // id is already extracted — no Context needed
}
```

Three forms:

```ts
// Single function or extractor — handler receives the value directly
@Extract(c => c.req.param("id"))
handler(id: string | undefined) {}

// Single built-in extractor
@Extract(query("page"))
handler(page: string | undefined) {}

// Record of extractors — handler receives a single object
@Extract({ id: param("id"), page: query("page"), body: json<CreateUserDto>() })
handler(params: { id: string | undefined; page: string | undefined; body: CreateUserDto }) {}
```

### Built-in extractors

| Extractor | What it returns |
|---|---|
| `param(name)` | URL path parameter (`:name`) |
| `query(name)` | Single query-string value |
| `queries(name)` | All values for a repeated query param |
| `header(name)` | Request header value |
| `json<T>()` | Parsed JSON body |
| `text()` | Plain text body |
| `parseBody(options?)` | Multipart or form-urlencoded body as a plain object. `{ all: true }` collects repeated fields into arrays; `{ dot: true }` parses dot-notation keys into nested objects. |
| `formData()` | Raw `FormData` object — use when you need `.get()` / `.getAll()` / file entries directly. |
| `arrayBuffer()` | Request body as `ArrayBuffer` |
| `bytes()` | Request body as `Uint8Array` |
| `blob()` | Request body as `Blob` |
| `ctxGet<T>(key)` | `c.get(key)` — middleware-set value |
| `ctxEnv<T>()` | `c.env` — platform environment bindings |
| `ctx()` | The raw `Context` (useful inside a Record extractor) |

### Transforming and validating

Extractors have two chainable methods:

```ts
// .pipe — transform the extracted value
@Extract(query("page").pipe(s => parseInt(s ?? "1", 10)))
list(page: number) {}

// .valid — validate with any Standard Schema–compatible library (Zod, Valibot, ArkType, etc.)
import { z } from "zod";

@Extract(json<unknown>().valid(z.object({ name: z.string() })))
create(body: { name: string }) {}
```

When `.valid()` fails, it throws an error that becomes an unhandled rejection — add Hono error handling middleware to convert it into a 400 response.


## @UseMiddleware

Attach Hono middleware to a controller class or a single route method.

```ts
import { UseMiddleware } from "ampulla/hono";
import type { MiddlewareHandler } from "hono";

const authMiddleware: MiddlewareHandler = async (c, next) => {
  const token = c.req.header("Authorization");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  c.set("userId", verifyToken(token));
  await next();
};

// Class-level: runs before every route in this controller
@UseMiddleware(authMiddleware)
@Controller("admin")
@Injectable()
class AdminController { ... }

// Method-level: runs only before this route
@UseMiddleware(rateLimitMiddleware)
@Get("resource")
getResource(c: Context) { ... }
```

Multiple `@UseMiddleware` decorators stack top-down — the topmost runs first. Class-level middleware runs before method-level middleware.

### Injectable middleware classes

For middleware that itself needs dependencies from the container, implement the `MiddlewareClass` interface and register it as a provider:

```ts
import type { MiddlewareClass } from "ampulla/hono";
import { Injectable } from "ampulla";

@Injectable(AUTH_SERVICE)
class AuthMiddleware implements MiddlewareClass {
  constructor(private readonly auth: AuthService) {}

  async use(c: Context, next: Next) {
    const token = c.req.header("Authorization");
    const user = await this.auth.verify(token);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", user);
    await next();
  }
}

@Module({
  providers: [AuthService, AuthMiddleware],
})
class AuthModule {}
```

Then reference the class (or its injection token) in `@UseMiddleware`:

```ts
@UseMiddleware(AuthMiddleware)
@Controller("admin")
@Injectable()
class AdminController { ... }
```

`registerControllers` detects that `AuthMiddleware` is a registered provider and resolves it from the container instead of using it as a plain function.


## @Header

Sets a fixed response header on a route. A thin wrapper around `@UseMiddleware`:

```ts
import { Header, Get } from "ampulla/hono";

@Header("Cache-Control", "public, max-age=3600")
@Header("X-Content-Type-Options", "nosniff")
@Get(":id")
getOne(c: Context) { ... }
```

Multiple `@Header` decorators stack like any other middleware — all headers are set before the handler runs.


## Full example

```ts
import { Hono } from "hono";
import { Injectable, Module, injection, useValue } from "ampulla";
import { Controller, Get, Post, Delete, Extract, UseMiddleware, Header } from "ampulla/hono";
import { param, json, ctxGet } from "ampulla/hono";
import { Container, registerControllers } from "ampulla";
import { z } from "zod";

// --- tokens ---
const DB = injection<Database>("DB");

// --- services ---
@Injectable(DB)
class UserService {
  constructor(private readonly db: Database) {}

  findAll() { return this.db.findAll("users"); }
  findOne(id: string) { return this.db.findOne("users", id); }
  create(data: { name: string }) { return this.db.insert("users", data); }
  delete(id: string) { return this.db.delete("users", id); }
}

// --- middleware ---
const logger: MiddlewareHandler = async (c, next) => {
  console.log(`${c.req.method} ${c.req.url}`);
  await next();
};

// --- controller ---
@UseMiddleware(logger)
@Controller("users")
@Injectable(UserService)
class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  list(c: Context) {
    return c.json(this.users.findAll());
  }

  @Header("Cache-Control", "no-store")
  @Get(":id")
  @Extract(param("id"))
  getOne(id: string | undefined) {
    return this.users.findOne(id ?? "");
  }

  @Post()
  @Extract(json<unknown>().valid(z.object({ name: z.string() })))
  async create(body: { name: string }) {
    return this.users.create(body);
  }

  @Delete(":id")
  @Extract(param("id"))
  remove(id: string | undefined) {
    return this.users.delete(id ?? "");
  }
}

// --- module ---
@Module({
  providers: [
    useValue(DB, new InMemoryDatabase()),
    UserService,
    UserController,
  ],
})
class AppModule {}

// --- bootstrap ---
const app = new Hono();
const container = await Container.create(AppModule);
registerControllers(app, container);

export default app;
```


## Error handling

| Error | When it's thrown |
|---|---|
| `ExtractionError` | A `@Extract` extractor threw. Inspect `.cause` for the underlying error. |
| `ValidationError` | A `.valid()` schema check failed. Surfaces as `.cause` on `ExtractionError`. |
| `InvalidHandlerError` | A route's handler name doesn't resolve to a function on the controller instance. |
