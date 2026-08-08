import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverProviderModels, fetchModels } from '../src/discovery.js';
import { OpenRouterMetadataPlugin } from '../src/index.js';
import type { OpenCodeConfig } from '../src/types.js';

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
