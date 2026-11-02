import { isObject } from "./object";
import { isBoolean, isNumber, isString } from "./type-guards";

/**
 * Checks one declared field of a decoded document and throws a
 * {@link FieldError} naming it when the value does not hold the field's type.
 * `loaded` is the same field as an earlier, already typed copy gave it; only
 * {@link asLoaded} reads it, for a field whose type no check can establish.
 * `declared` lets the compiler match each check to the field type it stands
 * for.
 */
export interface FieldCheck<T> {
  (value: unknown, field: string): asserts value is T;
  readonly declared?: T;
}

export type FieldChecks<T> = { [K in keyof T]-?: FieldCheck<T[K]> };

/** A decoded document's field that does not hold its declared type. */
export class FieldError extends Error {
  readonly field: string;
  readonly takes: string;

  constructor(field: string, takes: string) {
    super(`Field '${field}' does not hold ${takes}.`);
    this.field = field;
    this.takes = takes;
  }
}

function refuse(field: string, takes: string): never {
  throw new FieldError(field, takes);
}

export function leaf<T>(
  takes: string,
  holds: (value: unknown) => value is T,
): FieldCheck<T> {
  return (value, field) => {
    if (holds(value)) return;
    refuse(field, takes);
  };
}

export function optional<T>(check: FieldCheck<T>): FieldCheck<T | undefined> {
  return (value, field) => {
    if (value !== undefined) check(value, field);
  };
}

export function listOf<T>(takes: string, item: FieldCheck<T>): FieldCheck<T[]> {
  return (value, field) => {
    if (!Array.isArray(value)) {
      refuse(field, takes);
    }
    const items: unknown[] = value;
    items.forEach((entry, index) => {
      item(entry, `${field}.${index}`);
    });
  };
}

export function mapOf<T>(
  takes: string,
  entry: FieldCheck<T>,
): FieldCheck<Record<string, T>> {
  return (value, field) => {
    if (!isObject(value)) {
      refuse(field, takes);
    }
    for (const [key, item] of Object.entries(value)) {
      entry(item, `${field}.${key}`);
    }
  };
}

export function section<T>(
  takes: string,
  fields: FieldChecks<T>,
): FieldCheck<T> {
  const checks: [string, FieldCheck<unknown>][] = Object.entries(fields);
  return (value, field) => {
    if (!isObject(value)) {
      refuse(field, takes);
    }
    for (const [key, entry] of checks) {
      const check: FieldCheck<unknown> = entry;
      check(
        Object.getOwnPropertyDescriptor(value, key)?.value,
        field ? `${field}.${key}` : key,
      );
    }
  };
}

function isText(value: unknown): value is string {
  return isString(value);
}

function isTextOrList(value: unknown): value is string | string[] {
  return isString(value) || (Array.isArray(value) && value.every(isString));
}

function isNumberOrText(value: unknown): value is number | string {
  return isNumber(value) || isString(value);
}

function isFlag(value: unknown): value is boolean {
  return isBoolean(value);
}

export const text = leaf("a string", isText);
export const textOrList = leaf("a string or a list of strings", isTextOrList);
export const flag = leaf("a boolean", isFlag);
export const texts = listOf("a list of strings", text);
export const numberOrText = leaf("a number or a string", isNumberOrText);
export const number = leaf("a number", isNumber);

/** Any value, for a field the document leaves to its reader. */
export const anyValue: FieldCheck<unknown> = () => {};

export function literal<const L extends string>(expected: L): FieldCheck<L> {
  return leaf(`'${expected}'`, (value): value is L => value === expected);
}
