import { describe, expect, it } from 'vitest';
import { OpenRouterMetadataPlugin } from '../src/index.js';

describe('OpenRouterMetadataPlugin', () => {
  it('exports an OpenCode plugin function', async () => {
    const hooks = await OpenRouterMetadataPlugin({});

    expect(hooks).toBeTypeOf('object');
  });
});
