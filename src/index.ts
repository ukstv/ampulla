/**
 * Ampulla — dependency injection with NestJS ergonomics, built on TC39 decorators.
 *
 * Core primitives: `@Module`, `@Injectable`, `Container`, `injection`, `optional`,
 * `useValue`, `useFactory`, `useClass`, `@OnModuleInit`, `@OnModuleDestroy`.
 *
 * @example
 * ```ts
 * import { Container, Module, Injectable, injection, useValue } from "@ukstv/ampulla";
 *
 * const DB_URL = injection<string>("DB_URL");
 *
 * @Injectable(DB_URL)
 * class UserService {
 *   constructor(private readonly url: string) {}
 *   findAll() { return fetch(`${this.url}/users`).then(r => r.json()); }
 * }
 *
 * @Module({ providers: [useValue(DB_URL, "https://api.example.com"), UserService] })
 * class AppModule {}
 *
 * const container = await Container.create(AppModule);
 * const users = container.get(UserService);
 * await container.dispose();
 * ```
 *
 * @module
 */
export { Container } from "./container.js";
export { Module, useClass, useValue, useFactory } from "./module.js";
export { Injectable, injection, optional } from "./injectable.js";
export type { InjectionToken, DependencyToken, OptionalToken } from "./injectable.js";
export { OnModuleInit, OnModuleDestroy } from "./lifecycle.js";
export {
  NotAModuleError,
  InvalidProviderError,
  ProviderNotFoundError,
  ProviderNotInitializedError,
  DuplicateProviderError,
  InvalidExportError,
  CircularDependencyError,
} from "./errors.js";
