/**
 * A small in-memory IndexedDB: just the calls lib/client/device-drafts makes (open with onupgradeneeded, one-store
 * transactions with get/getAll/put/delete, deleteDatabase, databases). Same shape as the shim inside
 * p2-offline-store.test.ts, lifted out so later rounds can reuse it. Call installFakeIndexedDb() before importing
 * the store module.
 */
type Rec = Map<unknown, unknown>;
type Store = { keyPath?: string; rows: Rec };

const later = (fn: () => void) => setTimeout(fn, 0);
const clone = <T,>(v: T): T => (v instanceof Blob ? v : structuredClone(v));
function request<T>(fn: () => T) {
  const req: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
  req.result = fn();
  return req;
}

export function installFakeIndexedDb() {
  const dbs = new Map<string, Map<string, Store>>();
  const open: FakeDb[] = [];

  class FakeDb {
    onversionchange: (() => void) | null = null;
    closed = false;
    constructor(public name: string) {}
    get objectStoreNames() {
      const stores = dbs.get(this.name)!;
      return { contains: (n: string) => stores.has(n) };
    }
    createObjectStore(n: string, o?: { keyPath?: string }) {
      dbs.get(this.name)!.set(n, { keyPath: o?.keyPath, rows: new Map() });
    }
    close() {
      this.closed = true;
    }
    transaction(names: string[]) {
      if (this.closed) throw new Error("closed");
      const stores = dbs.get(this.name)!;
      const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: (n: string) => unknown } = {
        objectStore: (n: string) => {
          if (!names.includes(n)) throw new Error("not in tx");
          const s = stores.get(n)!;
          return {
            get: (k: unknown) => request(() => clone(s.rows.get(k))),
            getAll: () => request(() => [...s.rows.values()].map(clone)),
            put: (v: Record<string, unknown>, k?: unknown) =>
              request(() => {
                const key = s.keyPath ? v[s.keyPath] : k;
                s.rows.set(key, clone(v));
                return key;
              }),
            delete: (k: unknown) => request(() => void s.rows.delete(k)),
          };
        },
      };
      later(() => tx.oncomplete?.());
      return tx;
    }
  }

  const fakeIdb = {
    open(name: string) {
      const req: { result?: FakeDb; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
      later(() => {
        const fresh = !dbs.has(name);
        if (fresh) dbs.set(name, new Map());
        req.result = new FakeDb(name);
        open.push(req.result);
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase(name: string) {
      const req: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
      later(() => {
        for (const d of open) if (d.name === name && !d.closed) d.onversionchange?.();
        dbs.delete(name);
        req.onsuccess?.();
      });
      return req;
    },
    databases: async () => [...dbs.keys()].map((name) => ({ name, version: 1 })),
  };
  const ls = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.indexedDB = fakeIdb;
  g.localStorage ??= {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, String(v)),
    removeItem: (k: string) => void ls.delete(k),
    get length() {
      return ls.size;
    },
    key: (i: number) => [...ls.keys()][i] ?? null,
  };
  return { dbs };
}
