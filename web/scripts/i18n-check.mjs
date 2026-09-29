// Translation completeness check (run in CI):  node scripts/i18n-check.mjs [--verbose]
// 1. every t('key') / tr('key') used in src/ exists in en, hi and kn;
// 2. every part file defines the same keys in en, hi and kn;
// 3. reports hi/kn values that are identical to English (likely untranslated), ignoring technical tokens.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'src');
const verbose = process.argv.includes('--verbose');

function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(f)) out.push(p);
  }
  return out;
}

// --- dictionaries -------------------------------------------------------------
const dict = { en: {}, hi: {}, kn: {} };
const problems = [];

// inline dictionaries in lib/i18n.tsx: const en: Dict = { ... };
const core = fs.readFileSync(path.join(SRC, 'lib', 'i18n.tsx'), 'utf8');
for (const lang of ['en', 'hi', 'kn']) {
  const m = core.match(new RegExp(`const ${lang}: Dict = \\{([\\s\\S]*?)\\n\\};`));
  if (!m) { problems.push(`lib/i18n.tsx: dictionary ${lang} not found`); continue; }
  // eslint-disable-next-line no-new-func
  Object.assign(dict[lang], new Function(`return {${m[1]}}`)());
}
// part files: export default { en, hi, kn }
const partsDir = path.join(SRC, 'lib', 'i18n-parts');
for (const f of fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((x) => x.endsWith('.ts')) : []) {
  const code = ts.transpileModule(fs.readFileSync(path.join(partsDir, f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({}));
  const part = mod.exports.default ?? mod.exports;
  const keys = {};
  for (const lang of ['en', 'hi', 'kn']) {
    keys[lang] = new Set(Object.keys(part[lang] ?? {}));
    for (const [k, v] of Object.entries(part[lang] ?? {})) {
      if (dict[lang][k] !== undefined && dict[lang][k] !== v) problems.push(`${f}: key '${k}' (${lang}) is also defined elsewhere with different text`);
      dict[lang][k] = v;
    }
  }
  for (const k of keys.en) for (const lang of ['hi', 'kn']) if (!keys[lang].has(k)) problems.push(`${f}: '${k}' missing in ${lang}`);
  for (const lang of ['hi', 'kn']) for (const k of keys[lang]) if (!keys.en.has(k)) problems.push(`${f}: '${k}' in ${lang} but not in en`);
}

// --- usages -------------------------------------------------------------------
const used = new Map();
const rx = /\b(?:t|tr)\(\s*'([a-zA-Z0-9_.-]+)'/g;
for (const file of walk(SRC)) {
  if (file.includes(`${path.sep}i18n-parts${path.sep}`)) continue;
  const s = fs.readFileSync(file, 'utf8');
  for (const m of s.matchAll(rx)) used.set(m[1], path.relative(SRC, file));
}
for (const [k, file] of used) {
  for (const lang of ['en', 'hi', 'kn']) if (dict[lang][k] === undefined) problems.push(`${file}: t('${k}') has no ${lang} text`);
}

// --- untranslated values ------------------------------------------------------
const TECH = /^[\s\d.,:;/+\-–—·()%{}[\]#@&*'"!?<>=|]*$|^(Yukti|Laya|SOP|LOTO|P&ID|MCC|HOD|PTW|MFA|CSV|JSONL|PDF|OK|API|URL|GPU|CPU|RAM|VRAM|SHA-256|ID|MRPL|AI|LLM|Ollama|vLLM|llama\.cpp|LM Studio|Bionic|Email|Admin)$/i;
let same = 0;
for (const lang of ['hi', 'kn']) {
  for (const [k, v] of Object.entries(dict.en)) {
    if (dict[lang][k] === v && !TECH.test(String(v).trim()) && /[a-z]{3}/i.test(String(v))) {
      same++;
      if (verbose) console.log(`untranslated? ${lang} ${k}: ${v}`);
    }
  }
}

console.log(`i18n: ${Object.keys(dict.en).length} keys, ${used.size} used in code, ${same} hi/kn values identical to English`);
if (problems.length) {
  console.error(problems.slice(0, 200).join('\n'));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
