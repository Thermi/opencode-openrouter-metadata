import * as Ajv2020Module from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv/dist/2020.js';
import configSchema from './generated/opencode-config-schema.json' with { type: 'json' };

const MAX_NORMALIZATION_STEPS = 100;
const MODEL_PREFIX = ['models'];

type JsonObject = Record<string, unknown>;
type Validator = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
type AjvInstance = { compile: (schema: unknown) => Validator };
type AjvConstructor = new (options: { allErrors: boolean; strict: boolean }) => AjvInstance;

export interface ModelSanitizationResult {
  model?: JsonObject;
  dropped: string[];
  errors: string[];
  steps: number;
}

const AjvConstructor = Ajv2020Module.default as unknown as AjvConstructor;
const definitions = (configSchema as unknown as { $defs: Record<string, JsonObject> }).$defs;
const providerSchema = {
  ...definitions.ProviderConfig,
  $defs: definitions
};
const validateProvider = new AjvConstructor({ allErrors: true, strict: false }).compile(providerSchema);

function decodePointer(value: string): string[] {
  return value
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function modelErrors(model: JsonObject, modelKey: string): ErrorObject[] {
  validateProvider({ models: { [modelKey]: model } });
  return validateProvider.errors ?? [];
}

function removableField(error: ErrorObject, modelKey: string): string | undefined {
  const path = decodePointer(error.instancePath);
  const prefixMatches = MODEL_PREFIX.every((part, index) => path[index] === part) && path[1] === modelKey;
  if (!prefixMatches) return undefined;

  const field = path[2];
  if (field) return field;
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    return error.params.missingProperty;
  }
  if (error.keyword === 'additionalProperties' && typeof error.params.additionalProperty === 'string') {
    return error.params.additionalProperty;
  }
  return undefined;
}

function errorDescription(error: ErrorObject): string {
  return `${error.instancePath || '/'} ${error.message ?? error.keyword}`;
}

export function sanitizeModel(model: JsonObject, modelKey: string): ModelSanitizationResult {
  const candidate = JSON.parse(JSON.stringify(model)) as JsonObject;
  const dropped: string[] = [];

  for (let steps = 1; steps <= MAX_NORMALIZATION_STEPS; steps += 1) {
    const errors = modelErrors(candidate, modelKey);
    if (errors.length === 0) return { model: candidate, dropped, errors: [], steps };

    const field = errors.map((error) => removableField(error, modelKey)).find((value): value is string => Boolean(value));
    if (!field || !(field in candidate)) {
      return {
        dropped,
        errors: errors.map(errorDescription),
        steps
      };
    }

    delete candidate[field];
    dropped.push(field);
  }

  const errors = modelErrors(candidate, modelKey);
  return errors.length === 0
    ? { model: candidate, dropped, errors: [], steps: MAX_NORMALIZATION_STEPS }
    : { dropped, errors: errors.map(errorDescription), steps: MAX_NORMALIZATION_STEPS };
}

export function sanitizeModels(models: Record<string, JsonObject> | undefined): {
  models: Record<string, JsonObject>;
  dropped: Array<{ model: string; fields: string[]; errors: string[] }>;
} {
  const sanitized: Record<string, JsonObject> = {};
  const dropped: Array<{ model: string; fields: string[]; errors: string[] }> = [];

  for (const [modelKey, model] of Object.entries(models ?? {})) {
    const result = sanitizeModel(model, modelKey);
    if (result.model) sanitized[modelKey] = result.model;
    if (result.dropped.length > 0 || result.errors.length > 0) {
      dropped.push({ model: modelKey, fields: result.dropped, errors: result.errors });
    }
  }

  return { models: sanitized, dropped };
}
