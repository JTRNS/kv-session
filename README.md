# KV Session

A Deno module that provides a simple way to manage session data by combining [Deno's built-in key-value store](https://deno.com/manual/runtime/kv) with their [`SecureCookieMap`](https://deno.land/std/http/cookie_map.ts?s=SecureCookieMap).

## Features

- Simple session management using Deno's built-in key-value storage.
- Secure cookie handling with signature verification.
- No dependencies outside the standard library.
- Small enough to ~~copy and paste~~ read and understand.

## Usage

```typescript
import "https://deno.land/std/dotenv/load.ts";
import { serve } from "https://deno.land/std/http/server.ts";

import {
  createSession,
  KvSessionOptions,
} from "https://deno.land/x/kv_session/mod.ts";

const options: KvSessionOptions = {
  cookieName: "session_id",
  keySpace: "sessions",
  signatureKeys: [Deno.env.get("SECRET_KEY")!],
};

serve(async (request) => {
  const session = await createSession(request, options);
  await session.set("name", "bob");
  await session.set("email", "bob@example.com");

  const { value: name } = await session.get<string>("name");
  const headers = session.persist();
  return new Response(`Hello ${name ?? "anonymous"}`, { headers });

  // or just hit send
  const data = JSON.stringify(await session.list(), null, 2);
  return session.send(
    new Response(data, {
      headers: { "content-type": "application/json" },
    })
  );
});
```
