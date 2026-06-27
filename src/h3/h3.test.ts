import { describe, it, expect } from "vitest";
import { z } from "zod";
import { H3, type H3Event } from "h3";
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
  formData,
  bytes,
  ctxGet,
  ctx,
  registerControllers,
  InvalidHandlerError,
} from "./h3.js";

describe("h3 controller", () => {
  it("GET route returns a response", async () => {
    @Controller("users")
    @Injectable()
    class UserController {
      @Get()
      list() {
        return ["alice", "bob"];
      }
    }

    @Module({ providers: [UserController] })
    class AppModule {}

    const app = new H3();
    const container = await Container.create(AppModule);
    registerControllers(app, container);

    const res = await app.request("http://localhost/users");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["alice", "bob"]);
  });

  it("multiple routes on one controller", async () => {
    @Controller("items")
    @Injectable()
    class ItemController {
      @Get()
      list() {
        return ["a", "b"];
      }

      @Post()
      create() {
        return new Response(null, { status: 201 });
      }
    }

    @Module({ providers: [ItemController] })
    class AppModule {}

    const app = new H3();
    const container = await Container.create(AppModule);
    registerControllers(app, container);

    const getRes = await app.request("http://localhost/items");
    expect(getRes.status).toBe(200);

    const postRes = await app.request("http://localhost/items", {
      method: "POST",
    });
    expect(postRes.status).toBe(201);
  });

  it("route path segment appended to prefix", async () => {
    @Controller("users")
    @Injectable()
    class UserController {
      @Get(":id")
      getOne(event: H3Event) {
        return { id: event.context.params?.id };
      }
    }

    @Module({ providers: [UserController] })
    class AppModule {}

    const app = new H3();
    const container = await Container.create(AppModule);
    registerControllers(app, container);

    const res = await app.request("http://localhost/users/42");
    expect(((await res.json()) as any).id).toBe("42");
  });

  it("empty @Controller prefix registers route at the method path", async () => {
    @Controller()
    @Injectable()
    class RootController {
      @Get("ping")
      ping() {
        return "pong";
      }
    }
    @Module({ providers: [RootController] })
    class AppModule {}
    const app = new H3();
    registerControllers(app, await Container.create(AppModule));
    const res = await app.request("http://localhost/ping");
    expect(await res.text()).toBe("pong");
  });

  it("empty @Controller prefix with empty @Get registers at root", async () => {
    @Controller()
    @Injectable()
    class RootController {
      @Get()
      root() {
        return "root";
      }
    }
    @Module({ providers: [RootController] })
    class AppModule {}
    const app = new H3();
    registerControllers(app, await Container.create(AppModule));
    const res = await app.request("http://localhost/");
    expect(await res.text()).toBe("root");
  });

  it("trailing slash in @Controller prefix is stripped", async () => {
    @Controller("items/")
    @Injectable()
    class ItemController {
      @Get()
      list() {
        return "items";
      }
    }
    @Module({ providers: [ItemController] })
    class AppModule {}
    const app = new H3();
    registerControllers(app, await Container.create(AppModule));
    const res = await app.request("http://localhost/items");
    expect(await res.text()).toBe("items");
  });

  it("controller can receive injected dependencies", async () => {
    const GREETING = injection<string>("GREETING");

    @Controller("hello")
    @Injectable(GREETING)
    class HelloController {
      constructor(private readonly greeting: string) {}

      @Get()
      greet() {
        return this.greeting;
      }
    }

    @Module({
      providers: [useValue(GREETING, "hello world"), HelloController],
    })
    class AppModule {}

    const app = new H3();
    const container = await Container.create(AppModule);
    registerControllers(app, container);

    const res = await app.request("http://localhost/hello");
    expect(await res.text()).toBe("hello world");
  });

  it("class without @Controller is not registered", async () => {
    @Injectable()
    class PlainService {
      @Get()
      shouldNotMount() {
        return "oops";
      }
    }

    @Module({ providers: [PlainService] })
    class AppModule {}

    const app = new H3();
    const container = await Container.create(AppModule);
    registerControllers(app, container);

    const res = await app.request("http://localhost/");
    expect(res.status).toBe(404);
  });

  it("Put, Patch, Delete decorators register routes for their HTTP methods", async () => {
    @Controller("m")
    @Injectable()
    class MethodController {
      @Put() put() {
        return "put";
      }
      @Patch() patch() {
        return "patch";
      }
      @Delete() del() {
        return "delete";
      }
    }
    @Module({ providers: [MethodController] })
    class AppModule {}
    const app = new H3();
    registerControllers(app, await Container.create(AppModule));
    expect(
      await (await app.request("http://localhost/m", { method: "PUT" })).text(),
    ).toBe("put");
    expect(
      await (
        await app.request("http://localhost/m", { method: "PATCH" })
      ).text(),
    ).toBe("patch");
    expect(
      await (
        await app.request("http://localhost/m", { method: "DELETE" })
      ).text(),
    ).toBe("delete");
  });

  it("throws InvalidHandlerError when handler is not a function on the instance", () => {
    @Controller("bad")
    @Injectable()
    class BadController {
      @Get()
      handle() {
        return "ok";
      }
    }
    const fakeContainer = {
      [Symbol.iterator]() {
        return [[BadController, { handle: "not-a-function" }]][
          Symbol.iterator
        ]();
      },
    };
    expect(() => registerControllers(new H3(), fakeContainer as any)).toThrow(
      InvalidHandlerError,
    );
  });

  it("@Extract with single query extractor passes value directly", async () => {
    @Controller("search")
    @Injectable()
    class SearchController {
      @Extract(query("q"))
      @Get()
      search(q: string | undefined) {
        return q ?? "missing";
      }
    }

    @Module({ providers: [SearchController] })
    class AppModule {}

    const app = new H3();
    const container = await Container.create(AppModule);
    registerControllers(app, container);

    const res = await app.request("http://localhost/search?q=hello");
    expect(await res.text()).toBe("hello");
  });

  it("@Extract with Record extractor passes extracted object", async () => {
    @Controller("search")
    @Injectable()
    class SearchController {
      @Extract({ q: query("q") })
      @Get()
      search(params: { q: string | undefined }) {
        return params.q ?? "";
      }
    }

    @Module({ providers: [SearchController] })
    class AppModule {}

    const app = new H3();
    registerControllers(app, await Container.create(AppModule));

    const res = await app.request("http://localhost/search?q=hello");
    expect(await res.text()).toBe("hello");
  });

  it("@Extract .pipe transforms the extracted value", async () => {
    @Controller("items")
    @Injectable()
    class ItemController {
      @Extract({ page: query("page").pipe((s) => parseInt(s ?? "1", 10)) })
      @Get()
      list(params: { page: number }) {
        return String(params.page);
      }
    }

    @Module({ providers: [ItemController] })
    class AppModule {}

    const app = new H3();
    registerControllers(app, await Container.create(AppModule));

    const res = await app.request("http://localhost/items?page=3");
    expect(await res.text()).toBe("3");
  });

  it("@Extract .valid with StandardSchema validates and extracts", async () => {
    const UuidSchema = z.string().uuid();

    @Controller("things")
    @Injectable()
    class ThingController {
      @Extract(query("id").valid(UuidSchema))
      @Get()
      get(id: string) {
        return id;
      }
    }

    @Module({ providers: [ThingController] })
    class AppModule {}

    const app = new H3();
    registerControllers(app, await Container.create(AppModule));

    const validId = "550e8400-e29b-41d4-a716-446655440000";
    const ok = await app.request(`http://localhost/things?id=${validId}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe(validId);

    const bad = await app.request("http://localhost/things?id=not-a-uuid");
    expect(bad.status).toBe(500);
  });

  describe("built-in extractors", () => {
    it("param extracts path parameter", async () => {
      @Controller("users")
      @Injectable()
      class UserController {
        @Extract(param("id"))
        @Get(":id")
        get(id: string | undefined) {
          return id ?? "none";
        }
      }
      @Module({ providers: [UserController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      expect(
        await (await app.request("http://localhost/users/42")).text(),
      ).toBe("42");
    });

    it("query returns undefined when param is absent", async () => {
      @Controller("search")
      @Injectable()
      class SearchController {
        @Extract(query("q"))
        @Get()
        search(q: string | undefined) {
          return q ?? "missing";
        }
      }
      @Module({ providers: [SearchController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/search");
      expect(await res.text()).toBe("missing");
    });

    it("queries extracts multi-value query param", async () => {
      @Controller("search")
      @Injectable()
      class SearchController {
        @Extract(queries("tag"))
        @Get()
        list(tags: string[] | undefined) {
          return (tags ?? []).join(",");
        }
      }
      @Module({ providers: [SearchController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/search?tag=a&tag=b");
      expect(await res.text()).toBe("a,b");
    });

    it("queries returns undefined when param is absent", async () => {
      @Controller("search")
      @Injectable()
      class SearchController {
        @Extract(queries("tag"))
        @Get()
        list(tags: string[] | undefined) {
          return tags === undefined ? "none" : tags.join(",");
        }
      }
      @Module({ providers: [SearchController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/search");
      expect(await res.text()).toBe("none");
    });

    it("header extracts a request header", async () => {
      @Controller("me")
      @Injectable()
      class MeController {
        @Extract(header("x-user-id"))
        @Get()
        get(userId: string | undefined) {
          return userId ?? "anonymous";
        }
      }
      @Module({ providers: [MeController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/me", {
        headers: { "x-user-id": "u123" },
      });
      expect(await res.text()).toBe("u123");
    });

    it("header returns undefined when header is absent", async () => {
      @Controller("me")
      @Injectable()
      class MeController {
        @Extract(header("x-user-id"))
        @Get()
        get(userId: string | undefined) {
          return userId ?? "anonymous";
        }
      }
      @Module({ providers: [MeController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/me");
      expect(await res.text()).toBe("anonymous");
    });

    it("json parses JSON body", async () => {
      @Controller("echo")
      @Injectable()
      class EchoController {
        @Extract(json<{ msg: string }>())
        @Post()
        echo(body: { msg: string } | undefined) {
          return body?.msg ?? "";
        }
      }
      @Module({ providers: [EchoController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ msg: "hello" }),
      });
      expect(await res.text()).toBe("hello");
    });

    it("text parses text body", async () => {
      @Controller("echo")
      @Injectable()
      class EchoController {
        @Extract(text())
        @Post()
        echo(body: string | undefined) {
          return (body ?? "").toUpperCase();
        }
      }
      @Module({ providers: [EchoController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/echo", {
        method: "POST",
        body: "hello",
      });
      expect(await res.text()).toBe("HELLO");
    });

    it("formData parses FormData body", async () => {
      @Controller("form")
      @Injectable()
      class FormController {
        @Extract(formData())
        @Post()
        handle(fd: FormData) {
          return fd.get("name") as string;
        }
      }
      @Module({ providers: [FormController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const fd = new FormData();
      fd.append("name", "alice");
      const res = await app.request("http://localhost/form", {
        method: "POST",
        body: fd,
      });
      expect(await res.text()).toBe("alice");
    });

    it("bytes parses body as Uint8Array", async () => {
      @Controller("bin")
      @Injectable()
      class BinController {
        @Extract(bytes())
        @Post()
        handle(arr: Uint8Array | undefined) {
          return String(arr?.length ?? 0);
        }
      }
      @Module({ providers: [BinController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/bin", {
        method: "POST",
        body: new Uint8Array([1, 2, 3]),
      });
      expect(await res.text()).toBe("3");
    });

    it("ctxGet retrieves a middleware-set context variable", async () => {
      @Controller("me")
      @Injectable()
      class MeController {
        @Extract(ctxGet<string>("userId"))
        @Get()
        get(userId: string) {
          return userId;
        }
      }
      @Module({ providers: [MeController] })
      class AppModule {}
      const app = new H3();
      app.use("/me", async (event, next) => {
        event.context["userId"] = "u42";
        return next();
      });
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/me");
      expect(await res.text()).toBe("u42");
    });

    it("ctx() returns the raw H3Event inside a Record extractor", async () => {
      @Controller("mix")
      @Injectable()
      class MixController {
        @Extract({ q: query("q"), e: ctx() })
        @Get()
        handle(params: { q: string | undefined; e: H3Event }) {
          return params.q ?? "none";
        }
      }
      @Module({ providers: [MixController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/mix?q=hello");
      expect(await res.text()).toBe("hello");
    });
  });

  describe("@UseMiddleware", () => {
    it("method-level middleware runs before the handler", async () => {
      @Controller("ping")
      @Injectable()
      class PingController {
        @UseMiddleware(async (event, next) => {
          event.context["mw"] = "hit";
          return next();
        })
        @Get()
        ping(event: H3Event) {
          return event.context["mw"] ?? "miss";
        }
      }
      @Module({ providers: [PingController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/ping");
      expect(await res.text()).toBe("hit");
    });

    it("class-level middleware runs for every route", async () => {
      @UseMiddleware(async (event, next) => {
        event.context["role"] = "admin";
        return next();
      })
      @Controller("admin")
      @Injectable()
      class AdminController {
        @Get("a")
        routeA(event: H3Event) {
          return event.context["role"] ?? "none";
        }
        @Get("b")
        routeB(event: H3Event) {
          return event.context["role"] ?? "none";
        }
      }
      @Module({ providers: [AdminController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      expect(await (await app.request("http://localhost/admin/a")).text()).toBe(
        "admin",
      );
      expect(await (await app.request("http://localhost/admin/b")).text()).toBe(
        "admin",
      );
    });

    it("injectable class middleware is resolved from container", async () => {
      const MARKER = injection<string>("MARKER");

      @Injectable(MARKER)
      class TagMiddleware implements MiddlewareClass {
        constructor(private readonly tag: string) {}
        async use(event: H3Event, next: Parameters<MiddlewareClass["use"]>[1]) {
          event.context["tag"] = this.tag;
          return next();
        }
      }

      @UseMiddleware(TagMiddleware)
      @Controller("tagged")
      @Injectable()
      class TaggedController {
        @Get()
        get(event: H3Event) {
          return event.context["tag"] ?? "none";
        }
      }

      @Module({
        providers: [
          useValue(MARKER, "from-di"),
          TagMiddleware,
          TaggedController,
        ],
      })
      class AppModule {}

      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/tagged");
      expect(await res.text()).toBe("from-di");
    });

    it("injectable class middleware via InjectionToken is resolved from container", async () => {
      const MW = injection<MiddlewareClass>("MW");

      @UseMiddleware(MW)
      @Controller("tok")
      @Injectable()
      class TokController {
        @Get()
        get(event: H3Event) {
          return event.context["tok"] ?? "none";
        }
      }

      @Module({
        providers: [
          useValue(MW, {
            use: async (
              event: H3Event,
              next: Parameters<MiddlewareClass["use"]>[1],
            ) => {
              event.context["tok"] = "from-token";
              return next();
            },
          }),
          TokController,
        ],
      })
      class AppModule {}

      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/tok");
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
        async use(event: H3Event, next: Parameters<MiddlewareClass["use"]>[1]) {
          event.context["tag"] = this.svc.getTag();
          return next();
        }
      }

      @UseMiddleware(MW)
      @Controller("cls")
      @Injectable()
      class ClsController {
        @Get()
        get(event: H3Event) {
          return event.context["tag"] ?? "none";
        }
      }

      @Module({
        providers: [TagService, useClass(MW, TagMiddleware), ClsController],
      })
      class AppModule {}

      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/cls");
      expect(await res.text()).toBe("injected-tag");
    });

    it("multiple @UseMiddleware on a method run in top-down order", async () => {
      const order: string[] = [];
      @Controller("order")
      @Injectable()
      class OrderController {
        @UseMiddleware(async (_e, next) => {
          order.push("first");
          return next();
        })
        @UseMiddleware(async (_e, next) => {
          order.push("second");
          return next();
        })
        @Get()
        handle() {
          return "ok";
        }
      }
      @Module({ providers: [OrderController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      await app.request("http://localhost/order");
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
        get() {
          return "ok";
        }
      }
      @Module({ providers: [CachedController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/cached");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("multiple @Header decorators all appear in the response", async () => {
      @Controller("multi")
      @Injectable()
      class MultiController {
        @Header("X-A", "1")
        @Header("X-B", "2")
        @Get()
        get() {
          return "ok";
        }
      }
      @Module({ providers: [MultiController] })
      class AppModule {}
      const app = new H3();
      registerControllers(app, await Container.create(AppModule));
      const res = await app.request("http://localhost/multi");
      expect(res.headers.get("X-A")).toBe("1");
      expect(res.headers.get("X-B")).toBe("2");
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
      handle() {
        return "A";
      }
    }

    @Controller("b")
    @Injectable()
    class ControllerB {
      @Get()
      handle() {
        return "B";
      }
    }

    @Module({ providers: [ControllerA, ControllerB] })
    class AppModule {}

    const app = new H3();
    const container = await Container.create(AppModule);
    registerControllers(app, container);

    expect(await (await app.request("http://localhost/a")).text()).toBe("A");
    expect(await (await app.request("http://localhost/b")).text()).toBe("B");
  });
});
