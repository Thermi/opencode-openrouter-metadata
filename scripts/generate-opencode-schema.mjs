import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const version = readVersion(process.argv.slice(2));
const bun = process.env.BUN_BINARY ?? (process.platform === 'win32' ? 'bun.cmd' : 'bun');

function readVersion(args) {
  const argument = args.find((value) => value.startsWith('--opencode-version='));
  const value = argument?.slice('--opencode-version='.length) ?? process.env.OPENCODE_VERSION ?? '1.18.16';
  const normalized = value.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Invalid OpenCode version "${value}". Use --opencode-version=X.Y.Z or OPENCODE_VERSION=X.Y.Z.`);
  }
  return normalized;
}

function run(command, args, cwd) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveProcess();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

const generator = String.raw`import { ConfigV1 } from "./src/v1/config/config.ts"
import { Schema } from "effect"

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (!isRecord(value)) return value
  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
  if (Array.isArray(schema.anyOf)) {
    const anyOf = schema.anyOf.filter((item) => !isRecord(item) || item.type !== "null")
    if (anyOf.length !== schema.anyOf.length) {
      const { anyOf: _, ...rest } = schema
      if (anyOf.length === 1 && isRecord(anyOf[0])) return normalize({ ...anyOf[0], ...rest })
      return { ...rest, anyOf }
    }
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length === 1 && isRecord(schema.allOf[0])) {
    const { allOf: _, ...rest } = schema
    return normalize({ ...schema.allOf[0], ...rest })
  }
  if (schema.type === "integer" && schema.maximum === undefined) {
    return { ...schema, maximum: Number.MAX_SAFE_INTEGER }
  }
  return schema
}

function restoreModelRefs(value, key) {
  if (Array.isArray(value)) return value.map((item) => restoreModelRefs(item))
  if (!isRecord(value)) return value
  const schema = Object.fromEntries(Object.entries(value).map(([name, item]) => [name, restoreModelRefs(item, name)]))
  if ((key === "model" || key === "small_model") && schema.type === "string") {
    return { ...schema, $ref: "https://models.dev/model-schema.json#/$defs/Model" }
  }
  return schema
}

const document = Schema.toJsonSchemaDocument(ConfigV1.Info)
const normalized = normalize({ $schema: "https://json-schema.org/draft/2020-12/schema", ...document.schema, $defs: document.definitions })
const output = restoreModelRefs(normalized)
output.allowComments = true
output.allowTrailingCommas = true
await Bun.write(process.argv[2], JSON.stringify(output, null, 2))`;

const temporaryRoot = await mkdtemp(join(tmpdir(), 'opencode-schema-'));
const sourceRoot = join(temporaryRoot, `opencode-v${version}`);
const generatorPath = join(sourceRoot, 'packages', 'core', 'generate-schema.mjs');
const outputPath = join(temporaryRoot, 'opencode-config-schema.json');

try {
  await run('git', ['clone', '--depth', '1', '--branch', `v${version}`, 'https://github.com/anomalyco/opencode.git', sourceRoot], temporaryRoot);
  await run(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], sourceRoot);
  await run(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], join(sourceRoot, 'packages', 'core'));
  await writeFile(generatorPath, generator, 'utf8');
  await run(bun, ['run', 'generate-schema.mjs', outputPath], join(sourceRoot, 'packages', 'core'));

  const schema = await readFile(outputPath, 'utf8');
  await mkdir(join(root, 'src', 'generated'), { recursive: true });
  await writeFile(join(root, 'src', 'generated', 'opencode-config-schema.json'), schema, 'utf8');
  await writeFile(
    join(root, 'src', 'generated', 'opencode-schema-version.ts'),
    `export const OPENCODE_SCHEMA_VERSION = '${version}';\n`,
    'utf8'
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
