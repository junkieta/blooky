// blooky-context.ts
export type FxValue = unknown;

export interface FxContextInterface {
  get(key: string): unknown | undefined;
  has(key: string): boolean;
  keys(): string[]
  snapshot(): Record<string, unknown>;
  createChild(): FxContextInterface;
}

export interface FxContextInternalInterface extends FxContextInterface {
  set(key: string, value: unknown): void;
}

export class FxContextObject implements FxContextInternalInterface {
  private store: Record<string, FxValue>;
  private parent?: FxContextInterface;

  constructor(parent?: FxContextInterface) {
    this.store = Object.create(null);
    this.parent = parent;
  }

  get(key: string): FxValue | undefined {
    return key in this.store ? this.store[key] : this.parent?.get(key);
  }

  set(key: string, value: FxValue): void {
    this.store[key] = value;
  }

  has(key: string): boolean {
    return key in this.store || !!this.parent?.has(key);
  }

  hasOwn(key: string) {
    return key in this.store;
  }

  createChild(): FxContextInterface {
    return new FxContextObject(this);
  }

  keys(): string[] {
    const ownKeys = Object.keys(this.store);
    const parentKeys = this.parent?.keys() ?? [];
    return [...new Set([...ownKeys, ...parentKeys])];
  }
  
  snapshot(): Record<string, unknown> {
    return { ...this.parent?.snapshot(), ...Object.entries(this.store) };
  }

}
