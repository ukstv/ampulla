import { describe, it, expect } from "vitest";
import { Container, Module, Injectable, injection, useValue } from "../index.js";
import { tag, Tagged, allTagged } from "../tag.js";

describe("Tagged / getAllTagged", () => {
  it("returns instances of classes marked with the tag", async () => {
    const CONTROLLER = tag("controller");

    @Tagged(CONTROLLER)
    @Injectable()
    class UserController {}

    @Module({ providers: [UserController] })
    class AppModule {}

    const container = await Container.create(AppModule);
    const result = allTagged(container, CONTROLLER);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(UserController);
  });

  it("returns all instances with the tag, not just the first", async () => {
    const CONTROLLER = tag("controller");

    @Tagged(CONTROLLER)
    @Injectable()
    class UserController {}

    @Tagged(CONTROLLER)
    @Injectable()
    class PostController {}

    @Module({ providers: [UserController, PostController] })
    class AppModule {}

    const container = await Container.create(AppModule);
    const result = allTagged(container, CONTROLLER);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(expect.any(UserController));
    expect(result).toContainEqual(expect.any(PostController));
  });

  it("untagged class is not included", async () => {
    const CONTROLLER = tag("controller");

    @Injectable()
    class Service {} // no @Tagged

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    expect(allTagged(container, CONTROLLER)).toHaveLength(0);
  });

  it("a class tagged with A does not appear in getAllTagged(B)", async () => {
    const A = tag("A");
    const B = tag("B");

    @Tagged(A)
    @Injectable()
    class ServiceA {}

    @Tagged(B)
    @Injectable()
    class ServiceB {}

    @Module({ providers: [ServiceA, ServiceB] })
    class AppModule {}

    const container = await Container.create(AppModule);
    expect(allTagged(container, A)[0]).toBeInstanceOf(ServiceA);
    expect(allTagged(container, B)[0]).toBeInstanceOf(ServiceB);
  });

  it("a class can carry multiple tags and appears in each", async () => {
    const CONTROLLER = tag("controller");
    const HTTP_HANDLER = tag("http-handler");

    @Tagged(CONTROLLER, HTTP_HANDLER)
    @Injectable()
    class UserController {}

    @Module({ providers: [UserController] })
    class AppModule {}

    const container = await Container.create(AppModule);
    expect(allTagged(container, CONTROLLER)[0]).toBeInstanceOf(UserController);
    expect(allTagged(container, HTTP_HANDLER)[0]).toBeInstanceOf(UserController);
  });

  it("two tag() calls with the same label are distinct — no cross-container collision", async () => {
    const A = tag("controllers");
    const B = tag("controllers"); // same label, different identity

    @Tagged(A)
    @Injectable()
    class ServiceA {}

    @Module({ providers: [ServiceA] })
    class AppModule {}

    const container = await Container.create(AppModule);
    expect(allTagged(container, A)).toHaveLength(1);
    expect(allTagged(container, B)).toHaveLength(0);
  });

  it("non-class providers (value, factory) are never included", async () => {
    const THINGS = tag("things");
    const TOKEN = injection<string>("TOKEN");

    @Tagged(THINGS)
    @Injectable()
    class Service {}

    @Module({
      providers: [Service, useValue(TOKEN, "hello")],
    })
    class AppModule {}

    const container = await Container.create(AppModule);
    const result = allTagged(container, THINGS);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Service);
  });

  it("getAllTagged returns empty array after dispose()", async () => {
    const CONTROLLER = tag("controller");

    @Tagged(CONTROLLER)
    @Injectable()
    class Service {}

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    expect(allTagged(container, CONTROLLER)).toHaveLength(1);

    await container.dispose();
    expect(allTagged(container, CONTROLLER)).toHaveLength(0);
  });

  it("tagged providers across imported modules are all included", async () => {
    const SERVICE = tag("service");

    @Tagged(SERVICE)
    @Injectable()
    class ServiceA {}

    @Module({ providers: [ServiceA], exports: [ServiceA] })
    class ModuleA {}

    @Tagged(SERVICE)
    @Injectable()
    class ServiceB {}

    @Module({ imports: [ModuleA], providers: [ServiceB] })
    class AppModule {}

    const container = await Container.create(AppModule);
    const result = allTagged(container, SERVICE);
    expect(result).toHaveLength(2);
  });

  it("user-defined @Controller built on top of Tagged", async () => {
    const CONTROLLER = tag("controller");

    // User-land abstraction built on our primitives
    function Controller() {
      return Tagged(CONTROLLER);
    }

    @Controller()
    @Injectable()
    class UserController {
      handle() {
        return "users";
      }
    }

    @Module({ providers: [UserController] })
    class AppModule {}

    const container = await Container.create(AppModule);
    const controllers = allTagged(container, CONTROLLER);
    expect(controllers).toHaveLength(1);
    expect((controllers[0] as UserController).handle()).toBe("users");
  });
});
