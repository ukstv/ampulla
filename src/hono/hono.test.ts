import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Hono, type Context } from "hono";
import {
  Container,
  Module,
  Injectable,
  injection,
  useValue,
  useClass,
} from "../index.js";
import {
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
  type MiddlewareClass,
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
  registerControllers,
  InvalidHandlerError,
} from "./hono.js";
import { TestingContainer } from "../testing/testing.js";

describe("hono controller", () => {
  it("GET route returns a response", async () => {
    @Controller("users")
    @Injectable()
    class UserController {
      @Get()
      list(c: Context): Response {
        return c.json(["alice", "bob"]);
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [UserController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/users"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["alice", "bob"]);
  });

  it("multiple routes on one controller", async () => {
    @Controller("items")
    @Injectable()
    class ItemController {
      @Get()
      list(c: Context) {
        return c.json(["a", "b"]);
      }

      @Post()
      create(c: Context) {
        return c.json({ created: true }, 201);
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [ItemController],
    });
    registerControllers(app, container);

    const getRes = await app.fetch(new Request("http://localhost/items"));
    expect(getRes.status).toBe(200);

    const postRes = await app.fetch(
      new Request("http://localhost/items", { method: "POST" }),
    );
    expect(postRes.status).toBe(201);
  });

  it("route path segment appended to prefix", async () => {
    @Controller("users")
    @Injectable()
    class UserController {
      @Get(":id")
      getOne(c: Context) {
        return c.json({ id: c.req.param("id") });
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [UserController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/users/42"));
    expect(await res.json()).toEqual({ id: "42" });
  });

  it("empty @Controller prefix registers route at the method path", async () => {
    @Controller()
    @Injectable()
    class RootController {
      @Get("ping")
      ping(c: Context) {
        return c.text("pong");
      }
    }
    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [RootController],
    });
    registerControllers(app, container);
    const res = await app.fetch(new Request("http://localhost/ping"));
    expect(await res.text()).toBe("pong");
  });

  it("empty @Controller prefix with empty @Get path registers at root", async () => {
    @Controller()
    @Injectable()
    class RootController {
      @Get()
      root(c: Context) {
        return c.text("root");
      }
    }
    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [RootController],
    });
    registerControllers(app, container);
    const res = await app.fetch(new Request("http://localhost/"));
    expect(await res.text()).toBe("root");
  });

  it("trailing slash in @Controller prefix is stripped before joining", async () => {
    @Controller("items/")
    @Injectable()
    class ItemController {
      @Get()
      list(c: Context) {
        return c.text("items");
      }
    }
    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [ItemController],
    });
    registerControllers(app, container);
    const res = await app.fetch(new Request("http://localhost/items"));
    expect(await res.text()).toBe("items");
  });

  it("leading slash in @Get arg is stripped before joining", async () => {
    @Controller("users")
    @Injectable()
    class UserController {
      @Get("/:id")
      getOne(c: Context) {
        return c.json({ id: c.req.param("id") });
      }
    }
    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [UserController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/users/42"));
    expect(await res.json()).toEqual({ id: "42" });
  });

  it("controller can receive injected dependencies", async () => {
    const GREETING = injection<string>("GREETING");

    @Controller("hello")
    @Injectable(GREETING)
    class HelloController {
      constructor(private readonly greeting: string) {}

      @Get()
      greet(c: Context) {
        return c.text(this.greeting);
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [useValue(GREETING, "hello world"), HelloController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/hello"));
    expect(await res.text()).toBe("hello world");
  });

  it("class without @Controller is not registered", async () => {
    @Injectable()
    class PlainService {
      @Get()
      shouldNotMount(c: Context) {
        return c.text("oops");
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [PlainService],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(404);
  });

  it("@Extract with single query extractor passes value directly", async () => {
    @Controller("search")
    @Injectable()
    class SearchController {
      @Extract(query("q"))
      @Get()
      search(q: string | undefined) {
        return new Response(q ?? "missing");
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [SearchController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/search?q=hello"));
    expect(await res.text()).toBe("hello");
  });

  it("@Extract with query extractor passes extracted value", async () => {
    @Controller("search")
    @Injectable()
    class SearchController {
      @Extract({ q: query("q") })
      @Get()
      search(params: { q: string | undefined }) {
        return new Response(params.q ?? "");
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [SearchController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/search?q=hello"));
    expect(await res.text()).toBe("hello");
  });

  it("@Extract with query extractor returns undefined when param absent", async () => {
    @Controller("search")
    @Injectable()
    class SearchController {
      @Get()
      @Extract({ q: query("q") })
      search(params: { q: string | undefined }) {
        return new Response(params.q ?? "missing");
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [SearchController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/search"));
    expect(await res.text()).toBe("missing");
  });

  it("@Extract with query extractor and .pipe transform", async () => {
    @Controller("items")
    @Injectable()
    class ItemController {
      @Extract({ page: query("page").pipe((s) => parseInt(s ?? "1", 10)) })
      @Get()
      list(params: { page: number }) {
        return new Response(String(params.page));
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [ItemController],
    });
    registerControllers(app, container);

    const res = await app.fetch(new Request("http://localhost/items?page=3"));
    expect(await res.text()).toBe("3");
  });

  it("@Extract .pipe works with a Zod schema parse", async () => {
    const PageSchema = z.coerce.number().int().min(1).default(1);

    @Controller("items")
    @Injectable()
    class ItemController {
      @Extract({ page: query("page").pipe(PageSchema.parse.bind(PageSchema)) })
      @Get()
      list(params: { page: number }) {
        return new Response(String(params.page));
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [ItemController],
    });
    registerControllers(app, container);

    const withParam = await app.fetch(
      new Request("http://localhost/items?page=5"),
    );
    expect(await withParam.text()).toBe("5");

    const withDefault = await app.fetch(new Request("http://localhost/items"));
    expect(await withDefault.text()).toBe("1");
  });

  it("@Extract .pipe with Zod throws on invalid input", async () => {
    const IdSchema = z.string().uuid();

    @Controller("things")
    @Injectable()
    class ThingController {
      @Extract(query("id").pipe(IdSchema.parse.bind(IdSchema)))
      @Get()
      get(id: string) {
        return new Response(id);
      }
    }
    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [ThingController],
    });
    registerControllers(app, container);

    const res = await app.fetch(
      new Request("http://localhost/things?id=not-a-uuid"),
    );
    expect(res.status).toBe(500);
  });

  it("@Extract .valid with StandardSchema validates and extracts", async () => {
    const UuidSchema = z.string().uuid();

    @Controller("things")
    @Injectable()
    class ThingController {
      @Extract(query("id").valid(UuidSchema))
      @Get()
      get(id: string) {
        return new Response(id);
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [ThingController],
    });
    registerControllers(app, container);

    const validId = "550e8400-e29b-41d4-a716-446655440000";
    const ok = await app.fetch(
      new Request(`http://localhost/things?id=${validId}`),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe(validId);

    const bad = await app.fetch(
      new Request("http://localhost/things?id=not-a-uuid"),
    );
    expect(bad.status).toBe(500);
  });

  it("@Extract with raw function passes result as single arg", async () => {
    @Controller("users")
    @Injectable()
    class UserController {
      @Extract((c) => c.req.query("name"))
      @Get()
      greet(name: string | undefined) {
        return new Response(`hi ${name ?? "stranger"}`);
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [UserController],
    });
    registerControllers(app, container);

    const res = await app.fetch(
      new Request("http://localhost/users?name=alice"),
    );
    expect(await res.text()).toBe("hi alice");
  });

  describe("built-in extractors", () => {
    it("param extracts path parameter", async () => {
      @Controller("users")
      @Injectable()
      class UserController {
        @Extract(param("id"))
        @Get(":id")
        get(id: string | undefined) {
          return new Response(id ?? "none");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [UserController],
      });
      registerControllers(app, container);
      expect(
        await (
          await app.fetch(new Request("http://localhost/users/42"))
        ).text(),
      ).toBe("42");
    });

    it("queries extracts multi-value query param", async () => {
      @Controller("search")
      @Injectable()
      class SearchController {
        @Extract(queries("tag"))
        @Get()
        list(tags: string[] | undefined) {
          return new Response((tags ?? []).join(","));
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [SearchController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/search?tag=a&tag=b"),
      );
      expect(await res.text()).toBe("a,b");
    });

    it("header extracts a request header", async () => {
      @Controller("me")
      @Injectable()
      class MeController {
        @Extract(header("x-user-id"))
        @Get()
        get(userId: string | undefined) {
          return new Response(userId ?? "anonymous");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [MeController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/me", {
          headers: { "x-user-id": "u123" },
        }),
      );
      expect(await res.text()).toBe("u123");
    });

    it("json parses JSON body", async () => {
      @Controller("echo")
      @Injectable()
      class EchoController {
        @Extract(json<{ msg: string }>())
        @Post()
        echo(body: { msg: string }) {
          return new Response(body.msg);
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [EchoController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/echo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ msg: "hello" }),
        }),
      );
      expect(await res.text()).toBe("hello");
    });

    it("text parses text body", async () => {
      @Controller("echo")
      @Injectable()
      class EchoController {
        @Extract(text())
        @Post()
        echo(body: string) {
          return new Response(body.toUpperCase());
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [EchoController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/echo", {
          method: "POST",
          body: "hello",
        }),
      );
      expect(await res.text()).toBe("HELLO");
    });

    it("ctx() returns the raw Context inside a Record extractor", async () => {
      @Controller("mix")
      @Injectable()
      class MixController {
        @Extract({ q: query("q"), c: ctx() })
        @Get()
        handle(params: { q: string | undefined; c: Context }) {
          return params.c.text(params.q ?? "none");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [MixController],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/mix?q=hello"));
      expect(await res.text()).toBe("hello");
    });

    it("ctxGet retrieves a middleware-set variable", async () => {
      @Controller("me")
      @Injectable()
      class MeController {
        @Extract(ctxGet<string>("userId"))
        @Get()
        get(userId: string) {
          return new Response(userId);
        }
      }
      const app = new Hono();
      app.use("*", (c: Context, next) => {
        c.set("userId", "u42");
        return next();
      });
      const container = await TestingContainer.fromModule({
        providers: [MeController],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/me"));
      expect(await res.text()).toBe("u42");
    });
  });

  describe("@UseMiddleware", () => {
    it("method-level middleware runs before the handler", async () => {
      @Controller("ping")
      @Injectable()
      class PingController {
        @UseMiddleware(async (c, next) => {
          c.set("mw", "hit");
          await next();
        })
        @Get()
        ping(c: Context) {
          return c.text(c.get("mw") ?? "miss");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [PingController],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/ping"));
      expect(await res.text()).toBe("hit");
    });

    it("class-level middleware runs for every route", async () => {
      @UseMiddleware(async (c, next) => {
        c.set("role", "admin");
        await next();
      })
      @Controller("admin")
      @Injectable()
      class AdminController {
        @Get("a")
        routeA(c: Context) {
          return c.text(c.get("role") ?? "none");
        }
        @Get("b")
        routeB(c: Context) {
          return c.text(c.get("role") ?? "none");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [AdminController],
      });
      registerControllers(app, container);
      expect(
        await (await app.fetch(new Request("http://localhost/admin/a"))).text(),
      ).toBe("admin");
      expect(
        await (await app.fetch(new Request("http://localhost/admin/b"))).text(),
      ).toBe("admin");
    });

    it("injectable class middleware via InjectionToken is resolved from container", async () => {
      const MW_TOKEN = injection<MiddlewareClass>("MW_TOKEN");

      @UseMiddleware(MW_TOKEN)
      @Controller("tok")
      @Injectable()
      class TokController {
        @Get()
        get(c: Context) {
          return c.text(c.get("tok") ?? "none");
        }
      }

      const container = await TestingContainer.fromModule({
        providers: [
          useValue(MW_TOKEN, {
            use: async (
              c: Context,
              next: Parameters<MiddlewareClass["use"]>[1],
            ) => {
              c.set("tok", "from-token");
              await next();
            },
          }),
          TokController,
        ],
      });

      const app = new Hono();
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/tok"));
      expect(await res.text()).toBe("from-token");
    });

    it("injectable class middleware via useClass + InjectionToken resolves dependencies", async () => {
      const MW = injection<MiddlewareClass>("MW");

      @Injectable()
      class TagService {
        getTag() {
          return "injected-tag";
        }
      }

      @Injectable(TagService)
      class TagMiddleware implements MiddlewareClass {
        constructor(private readonly svc: TagService) {}
        async use(c: Context, next: Parameters<MiddlewareClass["use"]>[1]) {
          c.set("tag", this.svc.getTag());
          await next();
        }
      }

      @UseMiddleware(MW)
      @Controller("cls")
      @Injectable()
      class ClsController {
        @Get()
        get(c: Context) {
          return c.text(c.get("tag") ?? "none");
        }
      }

      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [TagService, useClass(MW, TagMiddleware), ClsController],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/cls"));
      expect(await res.text()).toBe("injected-tag");
    });

    it("injectable class middleware is resolved from container", async () => {
      const MARKER = injection<string>("MARKER");

      @Injectable(MARKER)
      class TagMiddleware implements MiddlewareClass {
        constructor(private readonly tag: string) {}
        async use(c: Context, next: Parameters<MiddlewareClass["use"]>[1]) {
          c.set("tag", this.tag);
          await next();
        }
      }

      @UseMiddleware(TagMiddleware)
      @Controller("tagged")
      @Injectable()
      class TaggedController {
        @Get()
        get(c: Context) {
          return c.text(c.get("tag") ?? "none");
        }
      }

      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [
          useValue(MARKER, "from-di"),
          TagMiddleware,
          TaggedController,
        ],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/tagged"));
      expect(await res.text()).toBe("from-di");
    });

    it("multiple @UseMiddleware on a method run in top-down order", async () => {
      const order: string[] = [];
      @Controller("order")
      @Injectable()
      class OrderController {
        @UseMiddleware(async (_c, next) => {
          order.push("first");
          await next();
        })
        @UseMiddleware(async (_c, next) => {
          order.push("second");
          await next();
        })
        @Get()
        handle(c: Context) {
          return c.text("ok");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [OrderController],
      });
      registerControllers(app, container);
      await app.fetch(new Request("http://localhost/order"));
      expect(order).toEqual(["first", "second"]);
    });
  });

  describe("@Header", () => {
    it("sets a response header", async () => {
      @Controller("cached")
      @Injectable()
      class CachedController {
        @Header("Cache-Control", "no-store")
        @Get()
        get(c: Context) {
          return c.text("ok");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [CachedController],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/cached"));
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("multiple @Header decorators all appear in the response", async () => {
      @Controller("multi")
      @Injectable()
      class MultiController {
        @Header("X-A", "1")
        @Header("X-B", "2")
        @Get()
        get(c: Context) {
          return c.text("ok");
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [MultiController],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/multi"));
      expect(res.headers.get("X-A")).toBe("1");
      expect(res.headers.get("X-B")).toBe("2");
    });
  });

  it("Put, Patch, Delete, Query decorators register routes for their HTTP methods", async () => {
    @Controller("m")
    @Injectable()
    class MethodController {
      @Put()
      put(c: Context) {
        return c.text("put");
      }
      @Patch()
      patch(c: Context) {
        return c.text("patch");
      }
      @Delete()
      del(c: Context) {
        return c.text("delete");
      }
      @Query()
      qry(c: Context) {
        return c.text("query");
      }
    }
    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [MethodController],
    });
    registerControllers(app, container);
    expect(
      await (
        await app.fetch(new Request("http://localhost/m", { method: "PUT" }))
      ).text(),
    ).toBe("put");
    expect(
      await (
        await app.fetch(new Request("http://localhost/m", { method: "PATCH" }))
      ).text(),
    ).toBe("patch");
    expect(
      await (
        await app.fetch(new Request("http://localhost/m", { method: "DELETE" }))
      ).text(),
    ).toBe("delete");
    expect(
      await (
        await app.fetch(new Request("http://localhost/m", { method: "QUERY" }))
      ).text(),
    ).toBe("query");
  });

  it("throws InvalidHandlerError when handler method is not a function on the instance", () => {
    @Controller("bad")
    @Injectable()
    class BadController {
      @Get()
      handle(c: Context) {
        return c.text("ok");
      }
    }
    const fakeContainer = {
      [Symbol.iterator]() {
        return [[BadController, { handle: "not-a-function" }]][
          Symbol.iterator
        ]();
      },
    };
    expect(() => registerControllers(new Hono(), fakeContainer as any)).toThrow(
      InvalidHandlerError,
    );
  });

  describe("remaining built-in extractors", () => {
    it("parseBody parses url-encoded body", async () => {
      @Controller("form")
      @Injectable()
      class FormController {
        @Post()
        @Extract(parseBody())
        handle(body: Record<string, string | File>) {
          return new Response(body.name as string);
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [FormController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/form", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "name=alice",
        }),
      );
      expect(await res.text()).toBe("alice");
    });

    it("formData parses FormData body", async () => {
      @Controller("form")
      @Injectable()
      class FormController {
        @Extract(formData())
        @Post()
        handle(fd: FormData) {
          return new Response(fd.get("name") as string);
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [FormController],
      });
      registerControllers(app, container);
      const fd = new FormData();
      fd.append("name", "alice");
      const res = await app.fetch(
        new Request("http://localhost/form", { method: "POST", body: fd }),
      );
      expect(await res.text()).toBe("alice");
    });

    it("arrayBuffer parses body as ArrayBuffer", async () => {
      @Controller("bin")
      @Injectable()
      class BinController {
        @Extract(arrayBuffer())
        @Post()
        handle(buf: ArrayBuffer) {
          return new Response(String(buf.byteLength));
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [BinController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/bin", {
          method: "POST",
          body: new Uint8Array([1, 2, 3]),
        }),
      );
      expect(await res.text()).toBe("3");
    });

    it("bytes parses body as Uint8Array", async () => {
      @Controller("bin")
      @Injectable()
      class BinController {
        @Extract(bytes())
        @Post()
        handle(arr: Uint8Array) {
          return new Response(String(arr.length));
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [BinController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/bin", {
          method: "POST",
          body: new Uint8Array([1, 2, 3]),
        }),
      );
      expect(await res.text()).toBe("3");
    });

    it("blob parses body as Blob", async () => {
      @Controller("bin")
      @Injectable()
      class BinController {
        @Extract(blob())
        @Post()
        handle(b: Blob) {
          return new Response(String(b.size));
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [BinController],
      });
      registerControllers(app, container);
      const res = await app.fetch(
        new Request("http://localhost/bin", {
          method: "POST",
          body: new Uint8Array([1, 2, 3]),
        }),
      );
      expect(await res.text()).toBe("3");
    });

    it("ctxEnv returns platform environment bindings", async () => {
      @Controller("env")
      @Injectable()
      class EnvController {
        @Extract(ctxEnv<{ API_KEY: string }>())
        @Get()
        handle(env: { API_KEY: string }) {
          return new Response(env.API_KEY);
        }
      }
      const app = new Hono();
      const container = await TestingContainer.fromModule({
        providers: [EnvController],
      });
      registerControllers(app, container);
      const res = await app.fetch(new Request("http://localhost/env"), {
        API_KEY: "secret",
      });
      expect(await res.text()).toBe("secret");
    });
  });

  it("@Extract throws when applied twice on the same method", () => {
    expect(() => {
      class Foo {
        @Extract(query("a"))
        @Extract(query("b"))
        @Get()
        handle(_: string | undefined) {}
      }
    }).toThrow('@Extract applied twice on "handle"');
  });

  it("multiple controllers are all registered", async () => {
    @Controller("a")
    @Injectable()
    class ControllerA {
      @Get()
      handle(c: Context) {
        return c.text("A");
      }
    }

    @Controller("b")
    @Injectable()
    class ControllerB {
      @Get()
      handle(c: Context) {
        return c.text("B");
      }
    }

    const app = new Hono();
    const container = await TestingContainer.fromModule({
      providers: [ControllerA, ControllerB],
    });
    registerControllers(app, container);

    expect(
      await (await app.fetch(new Request("http://localhost/a"))).text(),
    ).toBe("A");
    expect(
      await (await app.fetch(new Request("http://localhost/b"))).text(),
    ).toBe("B");
  });
});
