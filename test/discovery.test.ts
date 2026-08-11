import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverProviderModels, fetchModels } from '../src/discovery.js';
import { OpenRouterMetadataPlugin } from '../src/index.js';
import type { OpenCodeConfig } from '../src/types.js';
import { unknownModelField } from './schema-utils.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

async function mockServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock server did not bind');
  return `http://127.0.0.1:${address.port}/v1`;
}

describe('fetchModels', () => {
  it('requests /v1/models and forwards the configured authorization header', async () => {
    let requestPath = '';
    let authorization = '';
    const baseURL = await mockServer((request, response) => {
      requestPath = request.url ?? '';
      authorization = request.headers.authorization ?? '';
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-max' }] }));
    });

    await expect(fetchModels(baseURL, 'secret-key')).resolves.toEqual([{ id: 'qwen/qwen3.8-max' }]);
    expect(requestPath).toBe('/v1/models');
    expect(authorization).toBe('Bearer secret-key');
  });

  it('rejects non-success responses', async () => {
    const baseURL = await mockServer((_request, response) => {
      response.statusCode = 503;
      response.end('unavailable');
    });

    await expect(fetchModels(baseURL)).rejects.toThrow('HTTP 503');
  });
});

describe('discoverProviderModels', () => {
  it('maps the complete upstream model response', async () => {
    const baseURL = await mockServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          data: [
            {
              id: 'qwen/qwen3.8-max',
              name: 'Qwen 3.8 Max',
              context_length: 1_000_000,
              top_provider: { max_completion_tokens: 131_072 },
              supported_parameters: ['reasoning', 'reasoning_effort'],
              reasoning: { supported_efforts: ['low', 'high'], mandatory: false }
            }
          ]
        })
      );
    });

    const models = await discoverProviderModels({ options: { baseURL } });

    expect(models['qwen/qwen3.8-max']).toMatchObject({
      reasoning: true,
      variants: {
        low: { reasoning: { effort: 'low' } },
        high: { reasoning: { effort: 'high' } }
      }
    });
  });
});

describe('OpenRouterMetadataPlugin config hook', () => {
  it('targets every provider with a baseURL and preserves explicit overrides', async () => {
    const baseURL = await mockServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-max', name: 'Upstream name' }] }));
    });
    const config: OpenCodeConfig = {
      provider: {
        proxy: {
          options: { baseURL },
          models: { 'qwen/qwen3.8-max': { name: 'Local name' } }
        },
        unrelated: { models: { existing: { id: 'existing', name: 'Existing' } } }
      }
    };
    const hooks = await OpenRouterMetadataPlugin({ client: {} });

    await hooks.config?.(config as never);

    expect(config.provider?.proxy?.models?.['qwen/qwen3.8-max']).toMatchObject({
      id: 'qwen/qwen3.8-max',
      name: 'Local name'
    });
    expect(config.provider?.unrelated?.models).toEqual({
      existing: { id: 'existing', name: 'Existing' }
    });
  });

  it('sanitizes generated model metadata before returning it to OpenCode', async () => {
    const field = unknownModelField();
    const baseURL = await mockServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          data: [{ id: 'inclusionai/ling-3.0-tiny:free', name: 'Ling 3.0 Tiny', [field]: true }]
        })
      );
    });
    const config: OpenCodeConfig = {
      provider: { proxy: { options: { baseURL } } }
    };
    const logs: Array<{ body: { message: string; extra?: Record<string, unknown> } }> = [];
    const hooks = await OpenRouterMetadataPlugin({
      client: { app: { log: async (input: (typeof logs)[number]) => logs.push(input) } }
    });

    await hooks.config?.(config as never);

    expect(config.provider?.proxy?.models?.['inclusionai/ling-3.0-tiny:free']).not.toHaveProperty(field);
    expect(logs.some((entry) => entry.body.message.includes('Invalid model metadata removed'))).toBe(true);
  });

  it('applies metadata on newer OpenCode versions while using the older schema as a conservative subset', async () => {
    const baseURL = await mockServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/global/health') {
        response.end(JSON.stringify({ healthy: true, version: '9.9.9' }));
        return;
      }
      response.end(JSON.stringify({ data: [{ id: 'provider/model' }] }));
    });
    const config: OpenCodeConfig = {
      provider: { proxy: { options: { baseURL } } }
    };
    const hooks = await OpenRouterMetadataPlugin({ client: {}, serverUrl: new URL(baseURL).origin });

    await hooks.config?.(config as never);

    expect(config.provider?.proxy?.models?.['provider/model']).toBeDefined();
  });

  it('does not apply metadata when the running OpenCode version is older than the build schema', async () => {
    const baseURL = await mockServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/global/health') {
        response.end(JSON.stringify({ healthy: true, version: '1.18.3' }));
        return;
      }
      response.end(JSON.stringify({ data: [{ id: 'provider/model' }] }));
    });
    const config: OpenCodeConfig = {
      provider: { proxy: { options: { baseURL } } }
    };
    const hooks = await OpenRouterMetadataPlugin({ client: {}, serverUrl: new URL(baseURL).origin });

    await hooks.config?.(config as never);

    expect(config.provider?.proxy?.models).toBeUndefined();
  });

  it('honors explicit providers to restrict targeting', async () => {
    const firstBaseURL = await mockServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-max', name: 'Upstream name' }] }));
    });
    const secondBaseURL = await mockServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'qwen/qwen3.8-max', name: 'Upstream name' }] }));
    });
    const config: OpenCodeConfig = {
      provider: {
        first: { options: { baseURL: firstBaseURL } },
        second: { options: { baseURL: secondBaseURL } }
      }
    };
    const hooks = await OpenRouterMetadataPlugin({ client: {} }, { providers: ['second'] });

    await hooks.config?.(config as never);

    expect(config.provider?.first?.models).toBeUndefined();
    expect(config.provider?.second?.models).toBeDefined();
  });

  it('leaves configured models unchanged when discovery fails', async () => {
    const config: OpenCodeConfig = {
      provider: {
        proxy: {
          options: { baseURL: 'http://127.0.0.1:1/v1' },
          models: { existing: { id: 'existing', name: 'Existing' } }
        }
      }
    };
    const hooks = await OpenRouterMetadataPlugin({ client: {} });

    await hooks.config?.(config as never);

    expect(config.provider?.proxy?.models).toEqual({
      existing: { id: 'existing', name: 'Existing' }
    });
  });
});
