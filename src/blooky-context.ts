// src/blooky-context.ts

export type ContextKey = string;

export type ContextRef = {
  kind: "ctx";
  key: ContextKey;
};

export type LiteralPrimitive = undefined | null | boolean | number | bigint | string;

export type Literal = {
  kind: "literal";
  value: LiteralPrimitive;
};

export type ContextValue = ContextRef | Literal;

export type ContextErrorCode =
  | "ENCODE_UNBOUND"
  | "DECODE_MISSING_KEY"
  | "VALUE_CONSTRAINT";

export class ContextCodecError extends Error {
  readonly name = "ContextCodecError";

  constructor(
    public readonly code: ContextErrorCode,
    message: string,
    public readonly detail?: Record<string, unknown>
  ) {
    super(message);
  }
}

type ContextObject = Record<string, unknown>;

type ContextMeta = {
  keyToValue: Map<ContextKey, unknown>;
  valueToKeyObj: WeakMap<object, ContextKey>;
};

const META = new WeakMap<object, ContextMeta>();

const isLiteralPrimitive = (v: unknown): v is LiteralPrimitive =>
  v === undefined ||
  v === null ||
  typeof v === "boolean" ||
  typeof v === "number" ||
  typeof v === "bigint" ||
  typeof v === "string";

const isObjectLike = (v: unknown): v is object =>
  (typeof v === "object" && v !== null) || typeof v === "function";

export const isContextRef = (v: unknown): v is ContextRef =>
  !!v &&
  typeof v === "object" &&
  (v as any).kind === "ctx" &&
  typeof (v as any).key === "string";

export const isLiteral = (v: unknown): v is Literal =>
  !!v &&
  typeof v === "object" &&
  (v as any).kind === "literal" &&
  isLiteralPrimitive((v as any).value);

export const isContextValue = (v: unknown): v is ContextValue =>
  isContextRef(v) || isLiteral(v);

function assertContextObject(ctx: unknown): asserts ctx is ContextObject {
  if (!ctx || typeof ctx !== "object") {
    throw new ContextCodecError(
      "VALUE_CONSTRAINT",
      "[context] Context must be a non-null object."
    );
  }
}

const getOrInitMeta = (ctx: object): ContextMeta => {
  const existing = META.get(ctx);
  if (existing) return existing;

  const created: ContextMeta = {
    keyToValue: new Map<ContextKey, unknown>(),
    valueToKeyObj: new WeakMap<object, ContextKey>(),
  };
  META.set(ctx, created);
  return created;
};


/**
 * bind(ctx, key, value)
 * - key rebind with same value: no-op
 * - key rebind with different value: VALUE_CONSTRAINT
 */
export const bind = (ctx: unknown, key: ContextKey, value: unknown): void => {
  assertContextObject(ctx);

  if (typeof key !== "string") {
    throw new ContextCodecError(
      "VALUE_CONSTRAINT",
      `[context] ContextKey must be string. actual=${typeof key}`
    );
  }

  const meta = getOrInitMeta(ctx);
  if (meta.keyToValue.has(key)) {
    const current = meta.keyToValue.get(key);
    if (current !== value) {
      throw new ContextCodecError(
        "VALUE_CONSTRAINT",
        `[context] Rebinding key "${key}" with a different value is not allowed.`,
        { key }
      );
    }
    return;
  }

  meta.keyToValue.set(key, value);

  if (isObjectLike(value)) {
    const existingKey = meta.valueToKeyObj.get(value);
    if (!existingKey)
        meta.valueToKeyObj.set(value, key);
    else if (existingKey !== key) {
        throw new ContextCodecError(
        "VALUE_CONSTRAINT",
        `[context] Same object/function is bound to multiple keys.`,
        { key, existingKey }
        );
    }
  }
};

export const encode = (ctx: unknown, value: unknown): ContextValue => {
  assertContextObject(ctx);

  if (isLiteralPrimitive(value)) {
    return { kind: "literal", value };
  }

  const meta = META.get(ctx);
  if (!meta) {
    throw new ContextCodecError(
      "ENCODE_UNBOUND",
      "[context] Context has no bindings.",
      { phase: "encode", valueType: typeof value, hint: "bind before encode" }
    );
  }

  if (isObjectLike(value)) {
    const key = meta.valueToKeyObj.get(value);
    if (key !== undefined) {
      return { kind: "ctx", key };
    }

    throw new ContextCodecError(
      "ENCODE_UNBOUND",
      "[context] Value is not bound in this context.",
      { phase: "encode", valueType: typeof value, hint: "bind(ctx, key, value) first" }
    );
  }

  // symbol and any other non-literal primitive not allowed by this profile
  throw new ContextCodecError(
    "ENCODE_UNBOUND",
    "[context] Unsupported value for encode.",
    { phase: "encode", valueType: typeof value, hint: "only literal primitives or bound object/function are encodable" }
  );
};

export const decode = (ctx: unknown, ref: ContextRef): unknown => {
  assertContextObject(ctx);

  if (!isContextRef(ref)) {
    throw new ContextCodecError(
      "VALUE_CONSTRAINT",
      "[context] decode requires ContextRef.",
      { phase: "decode", actual: ref }
    );
  }

  let cur: object | null = ctx;
  while (cur && typeof cur === "object") {
    const meta = META.get(cur);
    if (meta && meta.keyToValue.has(ref.key)) {
      return meta.keyToValue.get(ref.key);
    }
    cur = Object.getPrototypeOf(cur);
  }

  throw new ContextCodecError(
    "DECODE_MISSING_KEY",
    `[context] Missing key "${ref.key}".`,
    { phase: "decode", key: ref.key }
  );
};

export const requireContextRef = (value: unknown, attrName: string): ContextRef => {
  if (!isContextRef(value)) {
    throw new ContextCodecError(
      "VALUE_CONSTRAINT",
      `[context] Attribute "${attrName}" requires ContextRef.`,
      { attrName, actual: value }
    );
  }
  return value;
};
