/**
 * Provides basic, but secure HTTP Session functionality by combining Deno's SecureCookieMap
 * with Deno's built-in KV Store.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@$STD_VERSION/http/server.ts";
 * import { createSession } from "https://deno.land/x/kv_session/mod.ts";
 *
 * serve(async (request) => {
 *   const session = await createSession(request, [Deno.env.get("SECRET_KEY")!]);
 *   const { value: name } = await session.get<string>("name");
 *   return session.send(new Response(`Hello ${name ?? "anonymous"}`));
 * });
 * ```
 *
 * @module
 */

export * from "./session.ts";
