import {
  bind,
  ContextCodecError,
  decode,
  encode,
} from "./blooky-context";

describe("blooky-context", () => {
  test('encode: literal primitives -> {kind:"literal"}', () => {
    const ctx = {};
    expect(encode(ctx, undefined)).toEqual({ kind: "literal", value: undefined });
    expect(encode(ctx, null)).toEqual({ kind: "literal", value: null });
    expect(encode(ctx, true)).toEqual({ kind: "literal", value: true });
    expect(encode(ctx, 42)).toEqual({ kind: "literal", value: 42 });
    expect(encode(ctx, 1n)).toEqual({ kind: "literal", value: 1n });
    expect(encode(ctx, "x")).toEqual({ kind: "literal", value: "x" });
  });

  test('encode: bind済み object/function -> {kind:"ctx"}', () => {
    const ctx = {};
    const obj = { id: 1 };
    const fn = () => 1;

    bind(ctx, "obj", obj);
    bind(ctx, "fn", fn);

    expect(encode(ctx, obj)).toEqual({ kind: "ctx", key: "obj" });
    expect(encode(ctx, fn)).toEqual({ kind: "ctx", key: "fn" });
  });

  test("encode: 未bind object/function -> ENCODE_UNBOUND", () => {
    const ctx = {};
    const obj = { id: 1 };
    const fn = () => 1;

    expect(() => encode(ctx, obj)).toThrow(ContextCodecError);
    expect(() => encode(ctx, obj)).toThrow(
      expect.objectContaining({ code: "ENCODE_UNBOUND" })
    );

    expect(() => encode(ctx, fn)).toThrow(ContextCodecError);
    expect(() => encode(ctx, fn)).toThrow(
      expect.objectContaining({ code: "ENCODE_UNBOUND" })
    );
  });

  test("decode: 子→親探索で子が勝つ（overlay）", () => {
    const parent = {};
    const child = Object.create(parent) as object;

    bind(parent, "k", "parent-value");
    bind(child, "k", "child-value");

    const ref =  { kind: "ctx", key: "k" } as const;
    expect(decode(child,ref)).toBe("child-value");
  });

  test("decode: 未登録 -> DECODE_MISSING_KEY", () => {
    const ctx = {};

    expect(() => decode(ctx, { kind: "ctx", key: "missing" })).toThrow(
      ContextCodecError
    );
    expect(() => decode(ctx, { kind: "ctx", key: "missing" })).toThrow(
      expect.objectContaining({ code: "DECODE_MISSING_KEY" })
    );
  });

  test("bind: 同一 key の再bind（同値OK / 異値NG）", () => {
    const ctx = {};
    const same = { id: 1 };
    const different = { id: 2 };

    expect(() => bind(ctx, "k", same)).not.toThrow();
    expect(() => bind(ctx, "k", same)).not.toThrow();

    expect(() => bind(ctx, "k", different)).toThrow(ContextCodecError);
    expect(() => bind(ctx, "k", different)).toThrow(
      expect.objectContaining({ code: "VALUE_CONSTRAINT" })
    );
  });

  test("bind: 同一 object/function を複数 key に束縛 -> VALUE_CONSTRAINT", () => {
    const ctx = {};
    const obj = { id: 1 };

    bind(ctx, "a", obj);
    expect(() => bind(ctx, "b", obj)).toThrow(ContextCodecError);
    expect(() => bind(ctx, "b", obj)).toThrow(
      expect.objectContaining({ code: "VALUE_CONSTRAINT" })
    );
  });

});
