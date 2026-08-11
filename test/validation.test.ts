import { describe, expect, it } from 'vitest';
import { sanitizeModel } from '../src/validation.js';
import { unknownModelField } from './schema-utils.js';

describe('sanitizeModel', () => {
  it('removes fields rejected by the pinned OpenCode schema', () => {
    const field = unknownModelField();
    const result = sanitizeModel(
      {
        id: 'inclusionai/ling-3.0-tiny:free',
        name: 'Ling 3.0 Tiny',
        [field]: true
      },
      'inclusionai/ling-3.0-tiny:free'
    );

    expect(result.model).toEqual({
      id: 'inclusionai/ling-3.0-tiny:free',
      name: 'Ling 3.0 Tiny'
    });
    expect(result.dropped).toEqual([field]);
  });

  it('drops a model that still fails after 100 normalization steps', () => {
    const model = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`invalid_${index}`, true]));

    const result = sanitizeModel(model, 'provider/model');

    expect(result.model).toBeUndefined();
    expect(result.steps).toBe(100);
    expect(result.dropped).toHaveLength(100);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
