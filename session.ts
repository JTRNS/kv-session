import { KeyStack } from "https://deno.land/std@0.190.0/crypto/keystack.ts";
import {
  Headered,
  Mergeable,
  mergeHeaders,
  SecureCookieMap,
} from "https://deno.land/std@0.190.0/http/cookie_map.ts";
import { toHashString } from "https://deno.land/std@0.190.0/crypto/to_hash_string.ts";

export interface KvSessionOptions {
  /** Cookie name that does not disclose unnecessary details about its purpose
   * and the technology stack behind it.
   * @default {"sid"}
   */
  cookieName?: string;

  /** Persists database underlying KV store at this path.
   * @default {undefined}
   */
  kvPath?: string | undefined;

  /** The key space for storing session data.
   * @default {"sessions"}
   */
  keySpace?: Deno.KvKeyPart;
}

/** Default options for {@linkcode createSession}. */
const DEFAULT_OPTIONS = {
  cookieName: "sid",
  keySpace: "sessions",
  kvPath: undefined,
};

/** Creates a new {@linkcode KvSession} instance */
export async function createSession(
  request: Request,
  signatureKeys: string[],
  options?: Partial<KvSessionOptions>,
): Promise<KvSession> {
  const { cookieName, keySpace, kvPath } = Object.assign(
    options ?? {},
    DEFAULT_OPTIONS,
  );
  const sessionKeyStack = new KeyStack(signatureKeys);
  const kv = await Deno.openKv(kvPath);
  const cookies = new SecureCookieMap(request, { keys: sessionKeyStack });
  const id = await cookies.get(cookieName) ?? KvSession.generateId();
  await cookies.set(cookieName, id, { path: "/" });
  return new KvSession({ kv, id, keySpace, cookies, cookieName });
}

/** Constructor arguments for {@linkcode KvSession} */
export interface KvSessionInit {
  kv: Deno.Kv;
  id: string;
  keySpace: Deno.KvKeyPart;
  cookieName: string;
  cookies: SecureCookieMap;
}

/** Used to construct a KvSession */
export class KvSession {
  #kv: Deno.Kv;
  #id: string;
  #keyspace: Deno.KvKey;
  #cookies: SecureCookieMap;
  #cookieName: string;

  /**
   * Constructs a new KvSession instance.
   *
   * ```ts
   * import { KeyStack } from "https://deno.land/std@$STD_VERSION/crypto/keystack.ts";
   * import {
   *   SecureCookieMap,
   *   serve,
   * } from "https://deno.land/std@$STD_VERSION/http/mod.ts";
   * import { Session } from "https://deno.land/x/kv_session/mod.ts";
   * const sessionKeyStack = new KeyStack(["secret_key_123"]);
   * const kv = await Deno.openKv();
   * const sessionKey = "sessions";
   * const cookieName = "session_id";
   * serve(async (request) => {
   *   const cookies = new SecureCookieMap(request, { keys: sessionKeyStack });
   *   const id = await cookies.get("session_id") ?? KvSession.generateId();
   *   await cookies.set(cookieName, id, { path: "/" });
   *   const session = new Session({ kv, id, sessionKey, cookies, cookieName });
   * });
   * ```
   *
   *  @param {KvSessionInit} init Arguments for constructing a new {@linkcode KvSession}.
   */
  constructor(
    init: KvSessionInit,
  ) {
    this.#kv = init.kv;
    this.#id = init.id;
    this.#keyspace = [init.keySpace];
    this.#cookieName = init.cookieName;
    this.#cookies = init.cookies;
  }

  get #key(): Deno.KvKey {
    return this.#keyspace.concat(this.#id);
  }
  get<T = unknown>(key: Deno.KvKey | Deno.KvKeyPart) {
    const k = Array.isArray(key) ? key : [key];
    return this.#kv.get<T>([...this.#key, ...k]);
  }
  set(key: Deno.KvKey | Deno.KvKeyPart, value: unknown) {
    const k = Array.isArray(key) ? key : [key];
    return this.#kv.set([...this.#key, ...k], value);
  }
  delete(key: Deno.KvKey | Deno.KvKeyPart) {
    const k = Array.isArray(key) ? key : [key];
    return this.#kv.delete([...this.#key, ...k]);
  }
  /** Retrieve an array for all KV entries for the active session. */
  async list<T = unknown>() {
    const values: Array<Deno.KvEntry<T>> = [];
    const iterator = this.#kv.list<T>({ prefix: this.#key });
    for await (const res of iterator) values.push(res);
    return values;
  }
  /** Persist the session by merging the reference to the session data,
   * the session ID, as a set-cookie header into the response.
   *
   * ```ts
   * return new Response("Hello World", {
   *   headers: session.persist(),
   * });
   * ```
   *
   * Combined with other headers:
   *
   * ```ts
   * const body = JSON.stringify({ name: "John Doe" });
   * return new Response(body, {
   *   headers: session.persist({
   *    "Content-Type": "application/json",
   *    "Cache-Control": "no-cache",
   *   })
   * });
   * ```
   */
  persist(...sources: (Headered | HeadersInit | Mergeable)[]): Headers {
    return mergeHeaders(...sources, this.#cookies);
  }
  send(response: Response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: mergeHeaders(response, this.#cookies),
    });
  }
  /** Destroy the session by deleting all session data from storage
   * and generate a new (anonymous) session ID. */
  async destroy() {
    const iterator = this.#kv.list({ prefix: this.#key });
    for await (const res of iterator) await this.#kv.delete(res.key);
    await this.#cookies.delete(this.#cookieName, { path: "/" });
    await this.#updateId();
  }
  /** Refreshes the session by moving all session data to a new random Id. */
  async refresh() {
    const freshId = KvSession.generateId();
    const iterator = this.#kv.list({ prefix: this.#key });
    for await (const res of iterator) {
      const freshKey = res.key.map((k) => k === this.#id ? freshId : k);
      await this.#kv.set(freshKey, res.value);
      await this.#kv.delete(res.key);
    }
    await this.#updateId(freshId);
    return freshId;
  }

  async #updateId(value?: string) {
    this.#id = value ?? KvSession.generateId();
    await this.#cookies.set(this.#cookieName, this.#id, {
      signed: true,
      "path": "/",
      overwrite: true,
    });
  }

  /** Generates a random 128 bit session ID. */
  static generateId() {
    return toHashString(crypto.getRandomValues(new Uint8Array(16)));
  }
}
