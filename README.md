# KV Session

**You are too early! Give me a day or two to finish up.**

[What](#what) | [How](#how) | [Why](#why)

A Deno module that provides a simple way to manage session data by combining [Deno's built-in key-value store](https://deno.com/manual/runtime/kv) with the [`SecureCookieMap`](https://deno.land/std/http/cookie_map.ts?s=SecureCookieMap) from the [standard library](https://deno.land/std?doc).

```typescript
import { serve } from "https://deno.land/std/http/server.ts";
import { createSession } from "https://deno.land/x/kv_session/mod.ts";

serve(async (request) => {
  const session = await createSession(request, [Deno.env.get("SECRET_KEY")!]);
  const { value: name } = await session.get<string>("name");
  return session.send(new Response(`Hello ${name ?? "anonymous"}`));
});
```

## What

- Simple session management using Deno's built-in key-value store.
- Secure cookie handling with signature verification.
- No dependencies outside the standard library.
- Small enough to ~~copy and paste~~ read and understand.

## How

- Retrieves a session id from a signed cookie or generates a new 128 bit identifier if cookie is missing or invalid.
- Creates a `KvSession` instance that includes some helper methods for common operations.
- Prepends the [key space](https://deno.com/manual/runtime/kv/key_space) for a subset of [KV operations](https://deno.com/manual/runtime/kv/operations) with a (configurable) "sessions" key and an id.

## Why

- Exploration of the possibilities within the Deno ecosystem.
