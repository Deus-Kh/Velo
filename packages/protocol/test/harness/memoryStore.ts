/**
 * In-memory stand-in for the client's AsyncStorage + Keychain. Synchronous,
 * so scenarios are deterministic and fast. `serialize`/`restore` model an
 * app restart; `clear` models a reinstall.
 */
export class MemoryStore {
  private map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(prefix = ''): string[] {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  getJson<T>(key: string): T | null {
    const raw = this.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  clear(): void {
    this.map.clear();
  }

  size(prefix = ''): number {
    return this.keys(prefix).length;
  }

  serialize(): string {
    return JSON.stringify([...this.map.entries()]);
  }

  static restore(json: string): MemoryStore {
    const s = new MemoryStore();
    for (const [k, v] of JSON.parse(json) as Array<[string, string]>) s.map.set(k, v);
    return s;
  }
}
