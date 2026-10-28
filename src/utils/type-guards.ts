interface TypeofTags {
  string: string;
  number: number;
  boolean: boolean;
  symbol: symbol;
  function: Function;
  object: object | null;
}

function hasTypeofTag<Tag extends keyof TypeofTags>(tag: Tag) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The only place a typeof tag is read; callers branch on the named guard it builds, which is the decoding the rule asks for.
  return (value: unknown): value is TypeofTags[Tag] => typeof value === tag;
}

/** Whether a value is a primitive string; boxed `String` objects are not. */
export const isString = hasTypeofTag("string");

/** Whether a value is a number, `NaN` and the infinities included. */
export const isNumber = hasTypeofTag("number");

/** Whether a value is a primitive boolean. */
export const isBoolean = hasTypeofTag("boolean");

/** Whether a value is a symbol. */
export const isSymbol = hasTypeofTag("symbol");

/** Whether a value is callable, class constructors included. */
export const isFunction = hasTypeofTag("function");

/** Whether a value is an object of any kind, `null` and arrays included. */
export const isObjectOrNull = hasTypeofTag("object");
