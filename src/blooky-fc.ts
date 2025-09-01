// blooky-fc.ts

import { isChainedProp, isStream, Prop } from "./blooky-fp";

// --- 型定義 ---

type Blueprint<A extends Object> = { [key in keyof A]: PropertyDescriptor };

const blueprint = <A extends Object>(o: A) : Blueprint<A> => {
    const descs : PropertyDescriptorMap[] = [];
    let p = o;
    while(p && p !== Object.prototype) {
        descs.push(Object.getOwnPropertyDescriptors(p));
        p = Object.getPrototypeOf(p);
    }
    return Object.assign({},...descs.reverse());
}

/**
 * 設計図の中から、指定されたキーを列挙不可に変更した、新しい設計図を返す。
 * @param keysToHide 隠蔽したいキーの配列
 * @param blueprint 元の設計図
 */
const unenumerable = (keysToHide: string[]) => <A extends Object>(blueprint: Blueprint<A>) : Blueprint<A> => {
  const newBlueprint = { ...blueprint };
  for (const key of keysToHide) {
    if (key in newBlueprint) {
      newBlueprint[key] = { ...newBlueprint[key], enumerable: false };
    }
  }
  return newBlueprint;
}

/**
 * 設計図の中から、指定されたキーを消去した設計図を返す
 * @param keys 削除したいキーの配列
 * @param blueprint 元の設計図
 */
const omit = <K extends string>(keys: K[]) => <A extends { [key in K]?:any }>(blueprint: Blueprint<A>) : Blueprint<Omit<A,K>> => {
  const newBlueprint = { ...blueprint };
  for (const key of keys) delete newBlueprint[key as keyof A];
  return newBlueprint as Blueprint<Omit<A,K>>;
}

/**
 * 設計図の中から、指定されたキーだけで構成した設計図を返す
 * @param keys 使用したいキーの配列
 * @param blueprint 元の設計図
 */
const pick = <K extends string>(keys: K[]) => <A extends { [key in K]?: any }>(blueprint: Blueprint<A>) : Blueprint<Pick<A,K>> => {
  const newBlueprint = {} as Blueprint<Pick<A,K>>;
  for (const key of keys) if(key in blueprint) newBlueprint[key] = blueprint[key];
  return newBlueprint;
}

// 型検証器の名前空間
const is = {
    /**
     * 値が nullableでないことを要求する
     */
    nonnull: (v: any) => v!=null,
    /**
     * 値が `string` 型であることを要求する Validator。
     */
    string: (v: any) => typeof v === "string",
    /**
     * 値が `number` 型であることを要求する Validator。
     */
    number: (v: any) => typeof v === "number",
    /**
     * 値が `Prop` であることを要求する Validator。
     */
    prop: isChainedProp,
    /**
     * 値が `Stream` であることを要求する Validator。
     */
    stream: isStream,
    /**
     * 値が `function` 型であることを要求する Validator。
     */
    function: (v: any) => typeof v === "function",
    // ... boolean, object など、必要に応じて追加

};




/**
 * 完成した設計図（ディスクリプタとオプションのProxy）から、
 * 最終的なコンテキストオブジェクトを生成（具現化）する。
 * ここで生成されるコンテキストは不変(frozen)となる。
 * @param spec プロパティディスクリプタで構成された設計図
 * @param options オプション（継承する親オブジェクト、適用するProxyHandler）
 */
function build<T extends object>(
  spec: Blueprint<T>,
  options: {
    parent?: object
    contract?: { [key: string]: (value: any) => boolean }
  } = {}
): T {
    // 仕様書（contract）が渡されていれば、検証を実行
    if (options.contract) {
        const contract = options.contract;
        for (const key in contract) {
            // a) 必須キーの存在チェック
            if (!(key in spec)) {
                throw new TypeError(`Context build failed: Required key "${key}" is missing from the blueprint.`);
            }
            // b) 列挙可能性のチェック
            const descriptor = spec[key];
            if(!descriptor.enumerable) {
                throw new TypeError(`Context build failed: Required key "${key}" is unenumarable.`);
            }
            // c) 型の整合性チェック
            const validator = contract[key];
            // `value`か`get`を持つディスクリプタのみを対象とする
            const isValid = "get" in descriptor
                ? validator(descriptor.get())
                : "value" in descriptor
                ? validator(descriptor.value)
                : true;
            if(!isValid)
                throw new TypeError(`Context build failed: The type of "${key}" is incorrect.`);
        }
    }
    return Object.freeze(Object.create("parent" in options ? options.parent || null : Object.prototype, spec));
}

/**
 * コンテキストを関数の第一引数に注入（prime）し、関数を実行する。
 * @param context 任意のコンテキストオブジェクト
 * @param func コンテキストを第一引数として受け取る関数
 */
const prime = <T extends object>(context: T) => <R>(func: (context: T) => R): R  => func(context);

/**
 * コンテキストを関数の`this`に宿らせ（embody）、新しい関数を返す。
 * @param context 任意のコンテキストオブジェクト
 * @param func コンテキストを`this`として受け取る関数
 */
const embody = <T extends object>(context: T) => <F extends (this: T, ...args: any[]) => any>(func: F): F => func.bind(context) as F;

const template = <R,T extends Record<string,any>>(fn:(v:T)=>R) => (ctx:T) => fn(ctx);

// 高階関数の引数順を入れ替える
// ex. reverse(prime) // === template
const reverse = <A,B,C>(f:(a:A)=>(b:B)=>C) => (b:B) => (a:A) => f(a)(b);


export {
    Blueprint,
    blueprint,build,prime,embody,template,reverse,
    omit,pick,unenumerable,
    is
}

