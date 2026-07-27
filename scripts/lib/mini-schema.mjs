/**
 * mini-schema.mjs — 依存ゼロの JSON Schema サブセット検証器
 *
 * docs/sources/schema/*.schema.json で使っているキーワードだけを実装する。
 *
 *   type / enum / const / required / properties / additionalProperties
 *   items / minItems / minLength / pattern / minimum / maximum
 *   anyOf / format ("uri" のみ、緩い検査)
 *
 * 未対応のキーワードが現れたら黙って無視せずエラーにする。
 * スキーマ側の書き間違いを検証が素通りするほうが危険なため。
 */

const SUPPORTED = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "minLength",
  "pattern",
  "minimum",
  "maximum",
  "anyOf",
  "format",
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "integer" || actual === "number";
  if (expected === "integer") return actual === "integer";
  return actual === expected;
}

/**
 * @returns {string[]} エラーメッセージの配列（空なら妥当）
 */
export function validate(value, schema, path = "$") {
  const errors = [];

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) {
      errors.push(
        `${path}: スキーマが未対応のキーワード "${key}" を使っている（mini-schema.mjs を拡張すること）`,
      );
    }
  }

  if (schema.anyOf) {
    const branchErrors = schema.anyOf.map((sub) => validate(value, sub, path));
    if (!branchErrors.some((e) => e.length === 0)) {
      errors.push(`${path}: anyOf のどの分岐にも一致しない`);
    }
    return errors;
  }

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expected.some((t) => typeMatches(value, t))) {
      errors.push(`${path}: 型が ${expected.join("|")} ではない（実際は ${typeOf(value)}）`);
      return errors; // 型が違えば以降の検査は意味がない
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: ${JSON.stringify(schema.const)} でなければならない`);
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(
      `${path}: ${JSON.stringify(value)} は許可値 [${schema.enum.map((v) => JSON.stringify(v)).join(", ")}] にない`,
    );
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: 文字数が ${schema.minLength} 未満`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(
        `${path}: パターン /${schema.pattern}/ に一致しない（値: ${JSON.stringify(value)}）`,
      );
    }
    if (schema.format === "uri" && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value)) {
      errors.push(`${path}: URI 形式ではない（値: ${JSON.stringify(value)}）`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: ${schema.minimum} 以上でなければならない`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: ${schema.maximum} 以下でなければならない`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: 要素数が ${schema.minItems} 未満`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(`${path}: 必須フィールド "${key}" が無い`);
      }
    }
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validate(value[key], sub, `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          errors.push(`${path}: 未知のフィールド "${key}"（スキーマに定義が無い）`);
        }
      }
    }
  }

  return errors;
}
