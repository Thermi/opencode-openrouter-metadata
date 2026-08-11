import configSchema from '../src/generated/opencode-config-schema.json' with { type: 'json' };

export function unknownModelField(): string {
  const schema = configSchema as unknown as {
    $defs: {
      ProviderConfig: {
        properties: {
          models: { additionalProperties: { properties: Record<string, unknown> } };
        };
      };
    };
  };
  const allowed = new Set(
    Object.keys(
      schema.$defs.ProviderConfig.properties.models.additionalProperties.properties,
    ),
  );
  let candidate = 'not_a_schema_field';
  while (allowed.has(candidate)) candidate = `_${candidate}`;
  return candidate;
}
