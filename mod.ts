import { KeyStack } from "https://deno.land/std@0.190.0/crypto/keystack.ts";
import {
  Headered,
  Mergeable,
  mergeHeaders,
  SecureCookieMap,
} from "https://deno.land/std@0.190.0/http/cookie_map.ts";
import { toHashString } from "https://deno.land/std@0.190.0/crypto/to_hash_string.ts";
import { ConnInfo } from "https://deno.land/std@0.190.0/http/server.ts";

export interface KvSessionOptions {
  /** Cookie name that does not disclose unnecessary details about its purpose. */
  cookieName: string;
  kvPath?: string;
  keySpace: Deno.KvKeyPart;
  signatureKeys: string[];
}

const DEFAULT_OPTIONS: KvSessionOptions = {
  cookieName: "sid",
  keySpace: "sessions",
  kvPath: undefined,
  signatureKeys: ["fb71680cce6b93787ab"]
};

export async function createSession(
  request: Request,
  options: Partial<KvSessionOptions> = {},
) {
  const { cookieName, keySpace, kvPath, signatureKeys } = Object.assign(
    options,
    DEFAULT_OPTIONS,
  );
  const sessionKeyStack = new KeyStack(signatureKeys);
  const kv = await Deno.openKv(kvPath);
  const cookies = new SecureCookieMap(request, { keys: sessionKeyStack });
  const id = await cookies.get(cookieName) ?? KvSession.generateId();
  await cookies.set(cookieName, id, { path: "/" });
  return new KvSession({ kv, id, keySpace, cookies, cookieName });
}

interface KvSessionInit {
  kv: Deno.Kv;
  id: string;
  keySpace: Deno.KvKeyPart;
  cookieName: string;
  cookies: SecureCookieMap;
}

export type Context = {
  connInfo: ConnInfo;
  session: KvSession
}

export type KvSessionHandler = (request: Request, context: Context) => Response | Promise<Response>;

class KvSession {
  #kv: Deno.Kv;
  #id: string;
  #keyspace: Deno.KvKey;
  #cookies: SecureCookieMap;
  #cookieName: string;

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
  /** Merges various sources of headers with the sessions set-cookie headers. */
  persist(...sources: (Headered | HeadersInit | Mergeable)[]) {
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

  static generateId() {
    return toHashString(crypto.getRandomValues(new Uint8Array(16)));
  }
}
