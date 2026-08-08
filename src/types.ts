export interface RawOpenRouterReasoning {
  supported_efforts?: unknown;
  default_effort?: unknown;
  default_enabled?: unknown;
  mandatory?: unknown;
}

export interface RawOpenRouterArchitecture {
  input_modalities?: unknown;
  output_modalities?: unknown;
  tokenizer?: unknown;
}

export interface RawOpenRouterPricing {
  prompt?: unknown;
  completion?: unknown;
  input_cache_read?: unknown;
  input_cache_write?: unknown;
}

export interface RawOpenRouterModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: RawOpenRouterArchitecture;
  pricing?: RawOpenRouterPricing;
  top_provider?: {
    max_completion_tokens?: unknown;
  };
  supported_parameters?: unknown;
  reasoning?: RawOpenRouterReasoning;
  [key: string]: unknown;
}

export interface OpenCodeModel {
  id: string;
  name: string;
  openrouter?: RawOpenRouterModel;
  organizationOwner?: string;
  family?: string;
  release_date?: string;
  status?: string;
  interleaved?: unknown;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  attachment?: boolean;
  modalities?: {
    input: string[];
    output: string[];
  };
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  variants?: Record<string, { reasoning: { effort: string } }>;
  [key: string]: unknown;
}

export interface OpenCodeProvider {
  npm?: string;
  name?: string;
  options?: {
    baseURL?: unknown;
    apiKey?: unknown;
    [key: string]: unknown;
  };
  models?: Record<string, Partial<OpenCodeModel>>;
  [key: string]: unknown;
}

export interface OpenCodeConfig {
  provider?: Record<string, OpenCodeProvider>;
  [key: string]: unknown;
}

export interface PluginOptions {
  providers?: string[];
  timeoutMs?: number;
}
