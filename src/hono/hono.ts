import type { Context, Handler, Hono, MiddlewareHandler } from "hono";
import type { ParseBodyOptions, BodyData } from "hono/utils/body";
import type { Container } from "../container.js";
import type { InjectionToken } from "../injectable.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ValidationError, ExtractionError, InvalidHandlerError } from "../http-errors.js";

// Decorators
export {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Query,
  Extract,
  UseMiddleware,
  Header,
};
export type { MiddlewareClass };

// extractors
export type { Extractor };
export {
  param,
  query,
  queries,
  header,
  json,
  text,
  parseBody,
  formData,
  arrayBuffer,
  bytes,
  blob,
  ctxGet,
  ctxEnv,
  ctx,
};

export {
  InvalidHandlerError,
  ExtractionError,
  ValidationError,
  registerControllers,
  K_ROUTE,
  K_EXTRACT,
  K_CONTROLLER_META,
};


const K_ROUTE: unique symbol = Symbol("ampulla:hono:route");
const K_CONTROLLER_META: unique symbol = Symbol("ampulla:hono:controller");
const K_EXTRACT: unique symbol = Symbol("ampulla:hono:extract");
const K_MIDDLEWARE: unique symbol = Symbol("ampulla:hono:middleware");

type RouteEntry = {
  method: string;
  path: string;
  handlerName: string;
};

type ControllerMeta = {
  prefix: string;
  routes: RouteEntry[];
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * A callable that extracts a value from a Hono `Context`, optionally async.
 *
 * Chain transforms with `.pipe()` or validate with `.valid()`:
 *
 * @example
 * query("page").pipe(s => parseInt(s ?? "1", 10))
 * query("id").valid(z.string().uuid())   // throws → 400 Bad Request on failure
 */
type Extractor<C, T> = {
  (c: C): T | Promise<T>;
  pipe<U>(fn: (v: Awaited<T>) => U | Promise<U>): Extractor<C, U>;
  valid<U>(schema: StandardSchemaV1<U>): Extractor<C, U>;
};

function makeExtractor<C, T>(fn: (c: C) => T | Promise<T>): Extractor<C, T> {
  const ext = ((c: C) => fn(c)) as Extractor<C, T>;
  ext.pipe = <U>(
    transform: (v: Awaited<T>) => U | Promise<U>,
  ): Extractor<C, U> =>
    makeExtractor(async (c) => transform((await fn(c)) as Awaited<T>));
  ext.valid = <U>(schema: StandardSchemaV1<U>): Extractor<C, U> =>
    makeExtractor(async (c) => {
      const result = await schema["~standard"].validate(await fn(c));
      if (result.issues)
        throw new ValidationError(result.issues.map((i) => i.message).join("; "));
      return result.value;
    });
  return ext;
}

/**
 * Extracts a single query-string parameter by name.
 * Returns `undefined` when the parameter is absent.
 *
 * @example
 * \@Extract({ q: query("q") })
 * \@Get("search")
 * search(params: { q: string | undefined }) { ... }
 *
 * // with transform:
 * \@Extract({ page: query("page").pipe(s => parseInt(s ?? "1", 10)) })
 *
 * // with Zod validation:
 * \@Extract({ id: query("id").pipe(z.string().uuid().parse) })
 */
/** `c.req.param(name)` — URL path parameter (e.g. `:id`). */
function param(name: string): Extractor<Context, string | undefined> {
  return makeExtractor((c) => c.req.param(name));
}

/** `c.req.query(name)` — single query-string parameter. */
function query(name: string): Extractor<Context, string | undefined> {
  return makeExtractor((c) => c.req.query(name));
}

/** `c.req.queries(name)` — all values for a repeated query parameter (e.g. `?tag=a&tag=b`). */
function queries(name: string): Extractor<Context, string[] | undefined> {
  return makeExtractor((c) => c.req.queries(name));
}

/** `c.req.header(name)` — request header value. */
function header(name: string): Extractor<Context, string | undefined> {
  return makeExtractor((c) => c.req.header(name));
}

/** `c.req.json()` — parses the request body as JSON. */
function json<T = unknown>(): Extractor<Context, T> {
  return makeExtractor((c) => c.req.json<T>());
}

/** `c.req.text()` — parses the request body as plain text. */
function text(): Extractor<Context, string> {
  return makeExtractor((c) => c.req.text());
}

/**
 * `c.req.parseBody()` — parses `multipart/form-data` or `application/x-www-form-urlencoded`.
 *
 * @param options.all  When `true`, repeated fields are returned as arrays instead of last-value-wins.
 * @param options.dot  When `true`, dot-notation keys (`obj.key`) are parsed into nested objects.
 */
function parseBody<Options extends Partial<ParseBodyOptions>>(
  options?: Options,
): Extractor<Context, BodyData<Options>> {
  return makeExtractor((c) => c.req.parseBody(options));
}

/** `c.req.formData()` — parses the request body as `FormData`. */
function formData(): Extractor<Context, FormData> {
  return makeExtractor((c) => c.req.formData());
}

/** `c.req.arrayBuffer()` — parses the request body as an `ArrayBuffer`. */
function arrayBuffer(): Extractor<Context, ArrayBuffer> {
  return makeExtractor((c) => c.req.arrayBuffer());
}

/** `c.req.bytes()` — parses the request body as a `Uint8Array`. */
function bytes(): Extractor<Context, Uint8Array> {
  return makeExtractor((c) => c.req.bytes());
}

/** `c.req.blob()` — parses the request body as a `Blob` (preserves MIME type). */
function blob(): Extractor<Context, Blob> {
  return makeExtractor((c) => c.req.blob());
}

/** `c.get(key)` — retrieves a middleware-set context variable. */
function ctxGet<T = unknown>(key: string): Extractor<Context, T> {
  return makeExtractor((c) => (c as any).get(key) as T);
}

/** `c.env` — platform environment bindings (Cloudflare Workers, Deno Deploy, etc.). */
function ctxEnv<T = unknown>(): Extractor<Context, T> {
  return makeExtractor((c) => (c as any).env as T);
}

/** Returns the raw `Context`. Use inside a Record extractor when the handler needs direct context access alongside other extracted values. */
function ctx(): Extractor<Context, Context> {
  return makeExtractor((c) => c);
}

// ---------------------------------------------------------------------------
// @Extract
// ---------------------------------------------------------------------------

type ExtractorFn = (c: Context) => unknown | Promise<unknown>;

type ExtractorSpec = ExtractorFn | Record<string, ExtractorFn>;

/**
 * Wires a per-method extractor into the route handler.
 *
 * Instead of receiving the raw Hono `Context`, the decorated method receives
 * the extracted (and optionally transformed) value produced by `spec`.
 *
 * Three call forms are accepted:
 *
 *   @Extract(c => c.req.param("id"))         // arbitrary fn → single arg
 *   @Extract(query("q"))                     // single extractor → single arg
 *   @Extract({ id: param("id"), q: query("q") }) // Record → single object arg
 *
 * `registerControllers` detects `K_EXTRACT` on the method and awaits the
 * extractor before calling the handler; methods without `@Extract` continue
 * to receive the raw `Context` as before.
 *
 * NOTE: stacking multiple `@Extract` on the same method is not yet
 * supported — composition order is unresolved. Revisit.
 */
function Extract(spec: ExtractorSpec) {
  return function (
    value: Function,
    _context: ClassMethodDecoratorContext,
  ): void {
    let extractorFn: ExtractorFn;
    if (typeof spec === "function") {
      extractorFn = spec;
    } else {
      const specEntries = Object.entries(spec);
      extractorFn = async (c: Context) => {
        const result: Record<string, unknown> = {};
        for (const [key, extractor] of specEntries) {
          result[key] = await extractor(c);
        }
        return result;
      };
    }
    Object.defineProperty(value, K_EXTRACT, {
      value: extractorFn,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

// ---------------------------------------------------------------------------
// @UseMiddleware
// ---------------------------------------------------------------------------

/** Implement this interface on an `@Injectable()` class to use it as middleware via `@UseMiddleware(MyClass)`. */
interface MiddlewareClass {
  use: MiddlewareHandler;
}

/** Constructor of a class that implements `MiddlewareClass`. */
type MiddlewareCtor = new (...args: any[]) => MiddlewareClass;
/** A `MiddlewareCtor` or an `InjectionToken` that resolves to a `MiddlewareClass` instance — both accepted by `@UseMiddleware`. */
type MiddlewareToken = MiddlewareCtor | InjectionToken<MiddlewareClass>;

/**
 * Attaches Hono middleware to a controller class or route handler method.
 *
 * - **Method-level**: runs only before that specific route's handler.
 * - **Class-level**: runs before every route's handler in the class.
 *
 * Multiple `@UseMiddleware` decorators stack top-down — the topmost runs first.
 *
 * `registerControllers` chains them as:
 *   `app.on(method, path, ...classMw, ...methodMw, handler)`
 *
 * @example
 * // class-level — runs for all routes
 * \@UseMiddleware(authMiddleware)
 * \@Controller("admin")
 * class AdminController { ... }
 *
 * // method-level — runs only for this route
 * \@UseMiddleware(rateLimitMiddleware)
 * \@Get("resource")
 * getResource(c: Context) { ... }
 */
function UseMiddleware(fn: MiddlewareHandler | MiddlewareToken) {
  function applyUseMiddleware(
    value: Function,
    context: ClassMethodDecoratorContext,
  ): void;
  function applyUseMiddleware(
    value: abstract new (...args: any[]) => any,
    context: ClassDecoratorContext,
  ): void;
  function applyUseMiddleware(
    value: any,
    _context: ClassMethodDecoratorContext | ClassDecoratorContext,
  ): void {
    const existing: (MiddlewareHandler | MiddlewareToken)[] =
      (value as any)[K_MIDDLEWARE] ?? [];
    Object.defineProperty(value, K_MIDDLEWARE, {
      value: [fn, ...existing],
      enumerable: false,
      configurable: true,
      writable: false,
    });
  }
  return applyUseMiddleware;
}

// ---------------------------------------------------------------------------
// @Header
// ---------------------------------------------------------------------------

/**
 * Sets a fixed response header on a route. Implemented as a `@UseMiddleware` that
 * calls `c.header(name, value)` before passing control to the next handler.
 *
 * Multiple `@Header` decorators on the same method stack like any other middleware.
 *
 * @example
 * \@Header("Cache-Control", "no-store")
 * \@Header("X-Robots-Tag", "noindex")
 * \@Get(":id")
 * getOne(c: Context) { ... }
 */
function Header(name: string, value: string) {
  return UseMiddleware(async (c, next) => {
    c.header(name, value);
    await next();
  });
}

// ---------------------------------------------------------------------------
// HTTP method decorators
// ---------------------------------------------------------------------------

function routeDecorator(method: string, path: string) {
  return function (
    value: Function,
    _context: ClassMethodDecoratorContext,
  ): void {
    Object.defineProperty(value, K_ROUTE, {
      value: { method, path },
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

/**
 * Marks a method as the handler for HTTP GET requests at the given path segment.
 *
 * The path is joined with the `@Controller` prefix via `joinPaths` — see that
 * function for the full joining rules. A leading slash is tolerated and stripped
 * before joining, so `@Get("foo")` and `@Get("/foo")` are equivalent.
 *
 * Omitting the argument (or passing `""`) registers the route at the controller
 * prefix itself with no extra segment.
 */
function Get(path = "") {
  return routeDecorator("GET", path);
}

/** Marks a method as the handler for HTTP POST requests at the given path segment, joined with the `@Controller` prefix. */
function Post(path = "") {
  return routeDecorator("POST", path);
}

/** Marks a method as the handler for HTTP PUT requests at the given path segment, joined with the `@Controller` prefix. */
function Put(path = "") {
  return routeDecorator("PUT", path);
}

/** Marks a method as the handler for HTTP PATCH requests at the given path segment, joined with the `@Controller` prefix. */
function Patch(path = "") {
  return routeDecorator("PATCH", path);
}

/** Marks a method as the handler for HTTP DELETE requests at the given path segment, joined with the `@Controller` prefix. */
function Delete(path = "") {
  return routeDecorator("DELETE", path);
}

/** Marks a method as the handler for HTTP QUERY requests (RFC 10008) at the given path segment, joined with the `@Controller` prefix. */
function Query(path = "") {
  return routeDecorator("QUERY", path);
}

// ---------------------------------------------------------------------------
// @Controller
// ---------------------------------------------------------------------------

/**
 * Marks a class as a Hono controller and sets its route prefix.
 *
 * At decoration time the class prototype is scanned for methods carrying a
 * `K_ROUTE` symbol (set by `@Get`, `@Post`, etc.). The collected routes are
 * stored on the class and later mounted by `registerControllers`.
 *
 * The prefix defaults to `""` when omitted, which registers routes directly
 * at the paths declared by the method decorators (e.g. `@Get("foo")` → `/foo`).
 *
 * Must be applied **after** `@Injectable` and the HTTP-method decorators in
 * source order so that all metadata is available when `@Controller` scans the
 * prototype. Decorator execution order: method decorators run first, then
 * class decorators bottom-to-top.
 */
function Controller(prefix = "") {
  return function (
    value: abstract new (...args: any[]) => any,
    _context: ClassDecoratorContext,
  ): void {
    const routes: RouteEntry[] = [];
    for (const key of Object.getOwnPropertyNames(value.prototype)) {
      const fn = value.prototype[key];
      if (typeof fn !== "function" || !(K_ROUTE in fn)) continue;
      const { method, path } = (fn as any)[K_ROUTE] as {
        method: string;
        path: string;
      };
      routes.push({ method, path, handlerName: key });
    }
    Object.defineProperty(value, K_CONTROLLER_META, {
      value: { prefix, routes } satisfies ControllerMeta,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Joins a controller prefix and a route path into a single Hono-ready path.
 *
 * Rules (mirrors NestJS `RoutePathFactory`):
 *
 * - Trailing slash on the prefix is stripped before joining.
 * - A leading slash on the route path is tolerated; if absent, one is added.
 * - The final path always starts with `/`.
 * - Trailing slashes are stripped from the result — except when the result
 *   would be exactly `"/"` (the root), which is left as-is.
 *
 * Examples:
 *   joinPaths("users",  "foo")    → "/users/foo"
 *   joinPaths("users",  "/foo")   → "/users/foo"   // leading slash on path tolerated
 *   joinPaths("users/", "foo")    → "/users/foo"   // trailing slash on prefix stripped
 *   joinPaths("users",  "")       → "/users"       // no extra segment
 *   joinPaths("",       "foo")    → "/foo"         // empty prefix
 *   joinPaths("",       "")       → "/"            // both empty → root
 */
function joinPaths(prefix: string, path: string): string {
  const joined = stripTrailingSlash(prefix) + addLeadingSlash(path);
  const withLeadingSlash = joined.startsWith("/") ? joined : `/${joined}`;
  return withLeadingSlash !== "/" ? stripTrailingSlash(withLeadingSlash) : "/";
}

function addLeadingSlash(path: string): string {
  return path && !path.startsWith("/") ? `/${path}` : path;
}

function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

// ---------------------------------------------------------------------------
// registerControllers
// ---------------------------------------------------------------------------

/**
 * Mounts all `@Controller`-annotated providers from the container onto the
 * Hono app.
 *
 * Iterates every `[token, instance]` pair in the container. For each class
 * token that carries `@Controller` metadata, the collected routes are
 * registered on `app` via `app.on(method, path, handler)`. Providers without
 * `@Controller` metadata are silently skipped.
 *
 * If a handler method carries a `@Extract` extractor (`K_EXTRACT`), it is
 * awaited and its result is passed as the sole argument; otherwise
 * the raw Hono `Context` is passed as before.
 *
 * Call this after `Container.create()` and before starting the server:
 *
 * @example
 * const app = new Hono();
 * const container = await Container.create(AppModule);
 * registerControllers(app, container);
 * export default app;
 */
function registerControllers(app: Hono, container: Container): void {
  for (const [token, instance] of container) {
    // Value / factory providers have non-function tokens — skip them.
    if (typeof token !== "function") continue;
    const meta = (token as any)[K_CONTROLLER_META] as
      | ControllerMeta
      | undefined;
    // Only class tokens decorated with @Controller carry this metadata.
    if (!meta) continue;
    // Class-level middleware applies to every route in this controller.
    const classMw: (MiddlewareHandler | MiddlewareToken)[] | undefined = (
      token as any
    )[K_MIDDLEWARE];
    for (const route of meta.routes) {
      const fn = (instance as any)[route.handlerName];
      if (typeof fn !== "function")
        throw new InvalidHandlerError(route.handlerName, token.name);
      // Bind once so `this` is correct regardless of how Hono calls the handler.
      const bound = (fn as Function).bind(instance);
      const path = joinPaths(meta.prefix, route.path);
      // @Extract stores an extractor on the prototype method; bound copies don't carry it.
      const extractorFn = fn[K_EXTRACT] as ExtractorFn | undefined;
      // @UseMiddleware (and @Header, which is implemented as @UseMiddleware) stored on prototype method.
      const methodMw: (MiddlewareHandler | MiddlewareToken)[] | undefined =
        fn[K_MIDDLEWARE];
      let handler: Handler;
      if (extractorFn) {
        // Run the extractor, await it, then pass the result as the sole arg.
        handler = async (c: Context) => {
          let params;
          try {
            params = await extractorFn(c);
          } catch (e) {
            throw new ExtractionError(e);
          }
          return bound(params);
        };
      } else {
        // No extractor — pass the raw Context directly (original Hono convention).
        handler = bound;
      }
      // Collect and resolve all middleware in order: class → method.
      const rawMw: (MiddlewareHandler | MiddlewareToken)[] = [];
      if (classMw) rawMw.push(...classMw);
      if (methodMw) rawMw.push(...methodMw);
      const middlewares: MiddlewareHandler[] = rawMw.map((item) => {
        if (container.has(item as any)) {
          const instance = container.get(item as any) as MiddlewareClass;
          return instance.use.bind(instance);
        }
        return item as MiddlewareHandler;
      });
      app.on(route.method, [path], ...middlewares, handler);
    }
  }
}
