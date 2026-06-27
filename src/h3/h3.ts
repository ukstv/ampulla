import type { H3, H3Event, Middleware as H3Middleware, HTTPMethod } from "h3";
import type { ClassMethodDecoratorFn } from "../types.js";
import type { Container } from "../container.js";
import type { InjectionToken } from "../injectable.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  ValidationError,
  ExtractionError,
  InvalidHandlerError,
} from "../http-errors.js";

// Decorators
export {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Extract,
  UseMiddleware,
  Header,
};
export type { MiddlewareClass };

// Extractors
export type { Extractor };
export {
  param,
  query,
  queries,
  header,
  json,
  text,
  formData,
  bytes,
  ctxGet,
  ctx,
};

// Registration & errors
export {
  registerControllers,
  InvalidHandlerError,
  ExtractionError,
  ValidationError,
};

const K_ROUTE: unique symbol = Symbol("ampulla:h3:route");
const K_CONTROLLER_META: unique symbol = Symbol("ampulla:h3:controller");
const K_EXTRACT: unique symbol = Symbol("ampulla:h3:extract");
const K_MIDDLEWARE: unique symbol = Symbol("ampulla:h3:middleware");

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
 * A callable that extracts a value from an h3 `H3Event`, optionally async.
 *
 * Chain transforms with `.pipe()` or validate with `.valid()`:
 *
 * @example
 * query("page").pipe(s => parseInt(s ?? "1", 10))
 * query("id").valid(z.string().uuid())
 */
type Extractor<E, T> = {
  (e: E): T | Promise<T>;
  pipe<U>(fn: (v: Awaited<T>) => U | Promise<U>): Extractor<E, U>;
  valid<U>(schema: StandardSchemaV1<U>): Extractor<E, U>;
};

function makeExtractor<E, T>(fn: (e: E) => T | Promise<T>): Extractor<E, T> {
  const ext = ((e: E) => fn(e)) as Extractor<E, T>;
  ext.pipe = <U>(
    transform: (v: Awaited<T>) => U | Promise<U>,
  ): Extractor<E, U> =>
    makeExtractor(async (e) => transform((await fn(e)) as Awaited<T>));
  ext.valid = <U>(schema: StandardSchemaV1<U>): Extractor<E, U> =>
    makeExtractor(async (e) => {
      const result = await schema["~standard"].validate(await fn(e));
      if (result.issues)
        throw new ValidationError(
          result.issues.map((i) => i.message).join("; "),
        );
      return result.value;
    });
  return ext;
}

/** URL path parameter (e.g. `:id`), populated by the router into `event.context.params`. */
function param(name: string): Extractor<H3Event, string | undefined> {
  return makeExtractor((e) => e.context?.params?.[name]);
}

/** Single query-string parameter. Returns the first value when repeated. */
function query(name: string): Extractor<H3Event, string | undefined> {
  return makeExtractor(
    (e) => new URL(e.req.url).searchParams.get(name) ?? undefined,
  );
}

/** All values for a repeated query parameter (e.g. `?tag=a&tag=b`). */
function queries(name: string): Extractor<H3Event, string[] | undefined> {
  return makeExtractor((e) => {
    const vals = new URL(e.req.url).searchParams.getAll(name);
    return vals.length > 0 ? vals : undefined;
  });
}

/** `event.req.headers.get(name)` — request header value. */
function header(name: string): Extractor<H3Event, string | undefined> {
  return makeExtractor((e) => e.req.headers.get(name) ?? undefined);
}

/** `event.req.json()` — parses the request body as JSON. */
function json<T = unknown>(): Extractor<H3Event, T | undefined> {
  return makeExtractor((e) => e.req.json() as Promise<T | undefined>);
}

/** `event.req.text()` — parses the request body as plain text. */
function text(): Extractor<H3Event, string> {
  return makeExtractor((e) => e.req.text());
}

/** `event.req.formData()` — parses the request body as `FormData`. */
function formData(): Extractor<H3Event, FormData> {
  return makeExtractor((e) => e.req.formData());
}

/** `event.req.bytes()` — parses the request body as a `Uint8Array`. */
function bytes(): Extractor<H3Event, Uint8Array> {
  return makeExtractor((e) => e.req.bytes());
}

/** `event.context[key]` — retrieves a middleware-set context variable. */
function ctxGet<T = unknown>(key: string): Extractor<H3Event, T> {
  return makeExtractor((e) => e.context?.[key] as T);
}

/** Returns the raw `H3Event`. Use inside a Record extractor when the handler needs direct event access alongside other extracted values. */
function ctx(): Extractor<H3Event, H3Event> {
  return makeExtractor((e) => e);
}

// ---------------------------------------------------------------------------
// @Extract
// ---------------------------------------------------------------------------

type ExtractorFn = (e: H3Event) => unknown | Promise<unknown>;
type ExtractorSpec = ExtractorFn | Record<string, ExtractorFn>;

/** Maps an `ExtractorSpec` to the value the decorated method will receive. */
type ExtractedType<S extends ExtractorSpec> = S extends ExtractorFn
  ? Awaited<ReturnType<S>>
  : {
      readonly [K in keyof S]: S extends Record<K, ExtractorFn>
        ? Awaited<ReturnType<S[K]>>
        : never;
    };

/**
 * Wires a per-method extractor into the route handler.
 *
 * Instead of receiving the raw `H3Event`, the decorated method receives the
 * extracted (and optionally transformed) value produced by `spec`.
 *
 *   @Extract(e => e.context?.params?.id)          // arbitrary fn → single arg
 *   @Extract(query("q"))                          // single extractor → single arg
 *   @Extract({ id: param("id"), q: query("q") })  // Record → single object arg
 *
 * Applying `@Extract` twice on the same method throws at decoration time —
 * use a single Record extractor to combine multiple values.
 */
function Extract<S extends ExtractorSpec>(
  spec: S,
): ClassMethodDecoratorFn<
  unknown,
  (arg: ExtractedType<S>, ...rest: any[]) => any
> {
  return function (
    value: Function,
    context: ClassMethodDecoratorContext,
  ): void {
    if (K_EXTRACT in value) {
      throw new Error(
        `@Extract applied twice on "${String(context.name)}" — use a single Record extractor to combine multiple values`,
      );
    }
    let extractorFn: ExtractorFn;
    if (typeof spec === "function") {
      extractorFn = spec;
    } else {
      const specEntries = Object.entries(spec);
      extractorFn = async (e: H3Event) => {
        const result: Record<string, unknown> = {};
        for (const [key, extractor] of specEntries) {
          result[key] = await extractor(e);
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
  use: H3Middleware;
}

/** Constructor of a class that implements `MiddlewareClass`. */
type MiddlewareCtor = new (...args: any[]) => MiddlewareClass;
/** A `MiddlewareCtor` or an `InjectionToken` that resolves to a `MiddlewareClass` instance — both accepted by `@UseMiddleware`. */
type MiddlewareToken = MiddlewareCtor | InjectionToken<MiddlewareClass>;

/**
 * Attaches h3 middleware to a controller class or route handler method.
 *
 * - **Method-level**: runs only before that specific route's handler.
 * - **Class-level**: runs before every route's handler in the class.
 *
 * Multiple `@UseMiddleware` decorators stack top-down — the topmost runs first.
 *
 * @example
 * \@UseMiddleware(authMiddleware)
 * \@Controller("admin")
 * class AdminController { ... }
 *
 * \@UseMiddleware(rateLimitMiddleware)
 * \@Get("resource")
 * getResource(event: H3Event) { ... }
 */
function UseMiddleware(fn: H3Middleware | MiddlewareToken) {
  function applyUseMiddleware(
    value: Function,
    context: ClassMethodDecoratorContext,
  ): void;
  function applyUseMiddleware(
    value: abstract new (...args: any[]) => any,
    context: ClassDecoratorContext,
  ): void;
  function applyUseMiddleware(value: any, _context: any): void {
    const existing: (H3Middleware | MiddlewareToken)[] =
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
 * calls `setResponseHeader(event, name, value)` before passing control on.
 *
 * @example
 * \@Header("Cache-Control", "no-store")
 * \@Get(":id")
 * getOne(event: H3Event) { ... }
 */
function Header(name: string, value: string) {
  return UseMiddleware(async (event, next) => {
    event.res.headers.set(name, value);
    return next();
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

/** Marks a method as the handler for HTTP GET requests at the given path segment, joined with the `@Controller` prefix. */
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

// ---------------------------------------------------------------------------
// @Controller
// ---------------------------------------------------------------------------

/**
 * Marks a class as an h3 controller and sets its route prefix.
 *
 * Must be applied after `@Injectable` and the HTTP-method decorators.
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
 * Mounts all `@Controller`-annotated providers from the container onto the h3 app.
 *
 * @example
 * const app = new H3();
 * const container = await Container.create(AppModule);
 * registerControllers(app, container);
 * export default app;
 */
function registerControllers(app: H3, container: Container): void {
  for (const [token, instance] of container) {
    if (typeof token !== "function") continue;
    const meta = (token as any)[K_CONTROLLER_META] as
      | ControllerMeta
      | undefined;
    if (!meta) continue;
    const classMw: (H3Middleware | MiddlewareToken)[] =
      (token as any)[K_MIDDLEWARE] ?? [];
    for (const route of meta.routes) {
      const fn = (instance as any)[route.handlerName];
      if (typeof fn !== "function")
        throw new InvalidHandlerError(route.handlerName, (token as any).name);
      const bound = (fn as Function).bind(instance);
      const path = joinPaths(meta.prefix, route.path);
      const extractorFn =
        K_EXTRACT in fn ? ((fn as any)[K_EXTRACT] as ExtractorFn) : null;
      const methodMw: (H3Middleware | MiddlewareToken)[] =
        fn[K_MIDDLEWARE] ?? [];
      let handler: (event: H3Event) => unknown | Promise<unknown>;
      if (extractorFn) {
        handler = async (event: H3Event) => {
          let params;
          try {
            params = await extractorFn(event);
          } catch (e) {
            throw new ExtractionError(e);
          }
          return bound(params);
        };
      } else {
        handler = bound;
      }
      const rawMw: (H3Middleware | MiddlewareToken)[] = [];
      if (classMw.length) rawMw.push(...classMw);
      if (methodMw.length) rawMw.push(...methodMw);
      const middlewares: H3Middleware[] = rawMw.map((item) => {
        if (container.has(item as any)) {
          const instance = container.get(item as any) as MiddlewareClass;
          return (event: H3Event, next: Parameters<H3Middleware>[1]) =>
            instance.use(event, next);
        }
        return item as H3Middleware;
      });
      app.on(
        route.method as HTTPMethod,
        path,
        handler,
        middlewares.length ? { middleware: middlewares } : undefined,
      );
    }
  }
}
