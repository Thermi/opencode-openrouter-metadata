import { describe, expect, it } from 'vitest';
import { deepMergeModel, mapOpenRouterModel, mapOpenRouterModels } from '../src/mapper.js';

describe('mapOpenRouterModel', () => {
  it('preserves the complete upstream record while normalizing OpenCode fields', () => {
    const raw = {
      id: 'qwen/qwen3.8-max',
      canonical_slug: 'qwen/qwen3.8-max',
      name: 'Qwen: Qwen 3.8 Max',
      description: 'A reasoning model',
      created: 1_754_000_000,
      family: 'qwen',
      release_date: '2026-08-03',
      status: 'active',
      interleaved: { field: 'reasoning_details' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Qwen' },
      pricing: { prompt: '0.000002', completion: '0.000006' },
      top_provider: { max_completion_tokens: 131_072 },
      supported_parameters: ['reasoning', 'reasoning_effort'],
      default_parameters: { temperature: null },
      knowledge_cutoff: '2026-07-01',
      expiration_date: null,
      links: { homepage: 'https://example.test' },
      benchmarks: { score: 99 },
      reasoning: {
        mandatory: true,
        supported_efforts: ['high']
      }
    };

    const model = mapOpenRouterModel(raw);

    expect(model.openrouter).toEqual(raw);
    expect(model.openrouter).not.toBe(raw);
    expect(model).toMatchObject({
      name: 'Qwen 3.8 Max',
      organizationOwner: 'qwen',
      family: 'qwen',
      release_date: '2026-08-03',
      status: 'active',
      interleaved: { field: 'reasoning_details' },
      reasoning: true,
      variants: { high: { reasoning: { effort: 'high' } } }
    });
  });

  it('maps reasoning, capabilities, modalities, limits, and pricing', () => {
    const model = mapOpenRouterModel({
      id: 'qwen/qwen3.8-max',
      name: 'Qwen 3.8 Max',
      context_length: 1_000_000,
      architecture: {
        input_modalities: ['text', 'image', 'audio'],
        output_modalities: ['text']
      },
      top_provider: { max_completion_tokens: 131_072 },
      pricing: {
        prompt: '0.000002',
        completion: '0.000006',
        input_cache_read: '0.00000025'
      },
      supported_parameters: ['reasoning', 'reasoning_effort', 'tools', 'temperature', 'structured_outputs'],
      reasoning: {
        mandatory: true,
        supported_efforts: ['xhigh', 'high', 'medium', 'low', 'minimal', 'none']
      }
    });

    expect(model).toMatchObject({
      id: 'qwen/qwen3.8-max',
      name: 'Qwen 3.8 Max',
      reasoning: true,
      tool_call: true,
      temperature: true,
      structured_output: true,
      attachment: true,
      modalities: {
        input: ['text', 'image', 'audio'],
        output: ['text']
      },
      limit: { context: 1_000_000, output: 131_072 },
      cost: { input: 2, output: 6, cache_read: 0.25 }
    });
    expect(model.variants).toEqual({
      xhigh: { reasoning: { effort: 'xhigh' } },
      high: { reasoning: { effort: 'high' } },
      medium: { reasoning: { effort: 'medium' } },
      low: { reasoning: { effort: 'low' } },
      minimal: { reasoning: { effort: 'minimal' } }
    });
    expect(model.variants?.none).toBeUndefined();
  });

  it('maps a model without reasoning as non-reasoning', () => {
    expect(
      mapOpenRouterModel({
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        supported_parameters: ['tools', 'temperature']
      })
    ).toEqual({
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      openrouter: {
        id: 'openai/gpt-4o',
        name: 'GPT-4o',
        supported_parameters: ['tools', 'temperature']
      },
      organizationOwner: 'openai',
      status: 'active',
      interleaved: false,
      tool_call: true,
      temperature: true,
      modalities: { input: ['text'], output: ['text'] }
    });
  });

  it('uses the id when the upstream name is missing', () => {
    expect(mapOpenRouterModel({ id: 'provider/model' })).toMatchObject({
      id: 'provider/model',
      name: 'provider/model'
    });
  });
});

describe('mapOpenRouterModels', () => {
  it('skips malformed records and indexes valid models by id', () => {
    expect(
      mapOpenRouterModels([{ id: 'one' }, { id: 42 }, {}, { id: 'two', name: 'Two' }])
    ).toEqual({
      one: {
        id: 'one',
        name: 'one',
        openrouter: { id: 'one' },
        status: 'active',
        interleaved: false,
        modalities: { input: ['text'], output: ['text'] }
      },
      two: {
        id: 'two',
        name: 'Two',
        openrouter: { id: 'two', name: 'Two' },
        status: 'active',
        interleaved: false,
        modalities: { input: ['text'], output: ['text'] }
      }
    });
  });
});

describe('deepMergeModel', () => {
  it('recursively merges overrides without allowing an id change', () => {
    const base = mapOpenRouterModel({
      id: 'qwen/qwen3.8-max',
      reasoning: { supported_efforts: ['low', 'high'] }
    });

    expect(
      deepMergeModel(base, {
        id: 'wrong/id',
        name: 'Custom name',
        limit: { output: 2048 },
        variants: { custom: { reasoning: { effort: 'high' } } }
      })
    ).toMatchObject({
      id: 'qwen/qwen3.8-max',
      name: 'Custom name',
      limit: { output: 2048 },
      variants: { custom: { reasoning: { effort: 'high' } } }
    });
  });
});
