/**
 * mini-yaml.mjs — 依存ゼロの YAML サブセットパーサ
 *
 * study-mapf の docs/sources/*.yaml は機械可読なマニフェストであり、
 * 使用する YAML 機能を意図的に以下のサブセットへ限定している。
 *
 *   - ブロックマッピング       key: value / key:
 *   - ブロックシーケンス       - value / - key: value
 *   - フローシーケンス（1行）  [] / [a, b, "c"]
 *   - スカラ                   "..." / '...' / 素のスカラ
 *   - null                     空値 / null / ~
 *   - 真偽値                   true / false
 *   - 整数                     -?[0-9]+
 *   - コメント                 # 行頭、または引用符の外側の " #"
 *
 * これ以外（アンカー、マージキー、複数行ブロックスカラ、複雑なフローマップ等）は
 * 明示的にエラーとする。曖昧に解釈して黙って通すより、落ちたほうが安全である。
 */

class YamlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = "YamlError";
    this.line = line;
  }
}

/** 引用符の外側にある " #" 以降をコメントとして落とす。 */
function stripComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function parseScalar(text, lineNo) {
  const s = text.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2)
      throw new YamlError(`閉じられていない二重引用符: ${s}`, lineNo);
    return s
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2)
      throw new YamlError(`閉じられていない単一引用符: ${s}`, lineNo);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith("[")) return parseFlowSequence(s, lineNo);
  if (s.startsWith("{")) throw new YamlError("フローマッピング {} は未対応", lineNo);
  if (s.startsWith("&") || s.startsWith("*") || s.startsWith("<<")) {
    throw new YamlError("アンカー/エイリアス/マージキーは未対応", lineNo);
  }
  if (s === "|" || s === ">" || s === "|-" || s === ">-") {
    throw new YamlError("ブロックスカラ (| / >) は未対応。1行の引用文字列を使うこと", lineNo);
  }
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

function parseFlowSequence(text, lineNo) {
  const s = text.trim();
  if (!s.startsWith("[") || !s.endsWith("]")) {
    throw new YamlError(`フローシーケンスが1行に収まっていない: ${s}`, lineNo);
  }
  const body = s.slice(1, -1).trim();
  if (body === "") return [];
  const items = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  for (const ch of body) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === "," && !inSingle && !inDouble) {
      items.push(parseScalar(buf, lineNo));
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (inSingle || inDouble) throw new YamlError(`閉じられていない引用符: ${s}`, lineNo);
  if (buf.trim() !== "") items.push(parseScalar(buf, lineNo));
  return items;
}

/** 引用符の外側で数えた [ ] の深さの差分。 */
function bracketDelta(text) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (const ch of text) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "[") depth += 1;
      else if (ch === "]") depth -= 1;
    }
  }
  return depth;
}

/**
 * 有意な行だけを {indent, content, lineNo} に正規化する。
 *
 * ★ フローシーケンスが複数行に折り返されている場合は 1 トークンへ連結する。
 *   Prettier で YAML を整形すると、長い `authors: [...]` が
 *
 *     authors:
 *       [
 *         "Roni Stern",
 *         ...
 *       ]
 *
 *   の形へ折り返される。1 行前提のままだとこれを解釈できず、
 *   マニフェストが読めなくなる（実際に一度壊れた）。
 */
function tokenize(source) {
  const out = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.includes("\t")) {
      throw new YamlError("インデントにタブは使用できない", i + 1);
    }
    const noComment = stripComment(raw);
    if (noComment.trim() === "") continue;
    if (noComment.trim() === "---") continue;

    const indent = noComment.length - noComment.trimStart().length;
    let content = noComment.trim();
    const startLine = i + 1;

    // 角括弧が閉じるまで後続行を取り込む。
    let depth = bracketDelta(content);
    while (depth > 0 && i + 1 < lines.length) {
      i += 1;
      const next = stripComment(lines[i]).trim();
      if (next === "") continue;
      // 要素間の区切りは既にカンマが入っているので、素直に連結する。
      content +=
        content.endsWith(",") || next.startsWith(",") || next.startsWith("]") ? next : ` ${next}`;
      depth += bracketDelta(next);
    }
    if (depth > 0) throw new YamlError("閉じられていない [", startLine);

    out.push({ indent, content, lineNo: startLine });
  }
  return out;
}

/**
 * indent 以上のブロックを1つ読み、値と次の位置を返す。
 * 型は先頭行が "- " で始まるかどうかで決める。
 */
function parseBlock(tokens, pos, indent) {
  if (pos >= tokens.length || tokens[pos].indent < indent) return [null, pos];
  // 折り返されたフローシーケンスが単独行になっている場合
  //   authors:
  //     ["a", "b"]
  // は、1 トークンのスカラとして扱う。
  if (tokens[pos].content.startsWith("[")) {
    return [parseScalar(tokens[pos].content, tokens[pos].lineNo), pos + 1];
  }
  return tokens[pos].content.startsWith("- ") || tokens[pos].content === "-"
    ? parseSequence(tokens, pos, indent)
    : parseMapping(tokens, pos, indent);
}

function parseSequence(tokens, pos, indent) {
  const items = [];
  let i = pos;
  while (i < tokens.length && tokens[i].indent === indent) {
    const tok = tokens[i];
    if (!tok.content.startsWith("- ") && tok.content !== "-") break;
    const rest = tok.content === "-" ? "" : tok.content.slice(2).trim();
    i += 1;

    if (rest === "") {
      // "-" 単独: 次のより深いブロックが要素本体
      const childIndent = i < tokens.length ? tokens[i].indent : -1;
      if (childIndent > indent) {
        const [value, next] = parseBlock(tokens, i, childIndent);
        items.push(value);
        i = next;
      } else {
        items.push(null);
      }
      continue;
    }

    const kv = splitKeyValue(rest, tok.lineNo);
    if (kv === null) {
      // 素のスカラ要素
      items.push(parseScalar(rest, tok.lineNo));
      continue;
    }

    // "- key: value" 形式。同じ論理行の後続キーは (indent + 2) にぶら下がる。
    const map = {};
    assign(map, kv.key, kv.value, tokens, tok.lineNo, indent + 2);
    if (kv.value === null && i < tokens.length && tokens[i].indent > indent + 2) {
      const [child, next] = parseBlock(tokens, i, tokens[i].indent);
      map[kv.key] = child;
      i = next;
    }
    while (
      i < tokens.length &&
      tokens[i].indent === indent + 2 &&
      !tokens[i].content.startsWith("- ")
    ) {
      const t2 = tokens[i];
      const kv2 = splitKeyValue(t2.content, t2.lineNo);
      if (kv2 === null) throw new YamlError(`マッピング内に想定外の行: ${t2.content}`, t2.lineNo);
      i += 1;
      if (kv2.value === null && i < tokens.length && tokens[i].indent > indent + 2) {
        const [child, next] = parseBlock(tokens, i, tokens[i].indent);
        map[kv2.key] = child;
        i = next;
      } else {
        map[kv2.key] = kv2.value;
      }
    }
    items.push(map);
  }
  return [items, i];
}

function parseMapping(tokens, pos, indent) {
  const map = {};
  let i = pos;
  while (i < tokens.length && tokens[i].indent === indent) {
    const tok = tokens[i];
    if (tok.content.startsWith("- ")) break;
    const kv = splitKeyValue(tok.content, tok.lineNo);
    if (kv === null) throw new YamlError(`"key: value" 形式ではない行: ${tok.content}`, tok.lineNo);
    if (Object.prototype.hasOwnProperty.call(map, kv.key)) {
      throw new YamlError(`同一マッピング内でキーが重複: ${kv.key}`, tok.lineNo);
    }
    i += 1;
    if (kv.value === null && i < tokens.length && tokens[i].indent > indent) {
      const [child, next] = parseBlock(tokens, i, tokens[i].indent);
      map[kv.key] = child;
      i = next;
    } else {
      map[kv.key] = kv.value;
    }
  }
  return [map, i];
}

function assign(map, key, value) {
  map[key] = value;
}

/** "key: value" を分解する。key でなければ null。 */
function splitKeyValue(text, lineNo) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ":" && !inSingle && !inDouble) {
      const after = text[i + 1];
      if (after === undefined || after === " ") {
        const key = text
          .slice(0, i)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key === "") throw new YamlError("空のキー", lineNo);
        const rest = text.slice(i + 1).trim();
        return { key, value: rest === "" ? null : parseScalar(rest, lineNo) };
      }
    }
  }
  return null;
}

/** YAML 文字列を JS の値へ変換する。 */
export function parseYaml(source) {
  const tokens = tokenize(source);
  if (tokens.length === 0) return null;
  const [value, next] = parseBlock(tokens, 0, tokens[0].indent);
  if (next !== tokens.length) {
    throw new YamlError(`解析が途中で止まった: ${tokens[next].content}`, tokens[next].lineNo);
  }
  return value;
}

export { YamlError };
