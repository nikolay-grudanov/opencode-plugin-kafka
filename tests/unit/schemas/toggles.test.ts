/**
 * Unit tests for the 8 combinations of toggles block in
 * src/schemas/index.ts (PluginConfigV003Schema) + validateToggles in
 * src/core/config.ts.
 *
 * @see specs/009-tool-based-response-delivery/tasks.md T015a
 */

import { describe, it, expect } from 'vitest';
import { PluginConfigV003Schema } from '../../../src/schemas/index.js';
import { validateToggles, parseConfigV003 } from '../../../src/core/config.js';
import { createTestRule } from '../helpers/testConfig.js';

function makeConfig(toggles: Record<string, boolean> | undefined) {
  return {
    topics: ['t1'],
    rules: [createTestRule({ name: 'r1', jsonPath: '$.t', promptTemplate: 'do ${$.t}', agentId: 'a1' })],
    ...(toggles ? { toggles } : {}),
  };
}

describe('PluginConfigV003Schema — toggles field', () => {
  it('accepts config without toggles (uses default empty object)', () => {
    const result = PluginConfigV003Schema.parse(makeConfig(undefined));
    expect(result.toggles).toEqual({
      toolDelivery: true,
      eventHook: true,
      pollingFallback: false,
    });
  });

  it('accepts config with empty toggles object (all defaults applied)', () => {
    const result = PluginConfigV003Schema.parse(makeConfig({}));
    expect(result.toggles).toEqual({
      toolDelivery: true,
      eventHook: true,
      pollingFallback: false,
    });
  });

  it('accepts explicit toggles', () => {
    const result = PluginConfigV003Schema.parse(
      makeConfig({ toolDelivery: false, eventHook: false, pollingFallback: true })
    );
    expect(result.toggles).toEqual({
      toolDelivery: false,
      eventHook: false,
      pollingFallback: true,
    });
  });

  it.each([
    [{ toolDelivery: true, eventHook: true, pollingFallback: true }],
    [{ toolDelivery: true, eventHook: true, pollingFallback: false }],
    [{ toolDelivery: true, eventHook: false, pollingFallback: true }],
    [{ toolDelivery: true, eventHook: false, pollingFallback: false }],
    [{ toolDelivery: false, eventHook: true, pollingFallback: true }],
    [{ toolDelivery: false, eventHook: true, pollingFallback: false }],
    [{ toolDelivery: false, eventHook: false, pollingFallback: true }],
    [{ toolDelivery: false, eventHook: false, pollingFallback: false }],
  ])('accepts all 8 toggle combinations: %o', (toggles) => {
    const result = PluginConfigV003Schema.parse(makeConfig(toggles));
    expect(result.toggles).toEqual(toggles);
  });

  it('rejects non-boolean values', () => {
    expect(() =>
      PluginConfigV003Schema.parse(makeConfig({ toolDelivery: 'yes' as unknown as boolean }))
    ).toThrow();
  });
});

describe('validateToggles (called by parseConfigV003)', () => {
  it('throws when all three toggles are false', () => {
    const config = PluginConfigV003Schema.parse(
      makeConfig({ toolDelivery: false, eventHook: false, pollingFallback: false })
    );
    expect(() => validateToggles(config)).toThrow(/no delivery mechanism/i);
  });

  it.each([
    [{ toolDelivery: true, eventHook: true, pollingFallback: true }],
    [{ toolDelivery: true, eventHook: true, pollingFallback: false }],
    [{ toolDelivery: true, eventHook: false, pollingFallback: true }],
    [{ toolDelivery: false, eventHook: true, pollingFallback: true }],
  ])('allows config with at least one toggle on: %o', (toggles) => {
    const config = PluginConfigV003Schema.parse(makeConfig(toggles));
    expect(() => validateToggles(config)).not.toThrow();
  });

  it('allows defaults (all on except pollingFallback)', () => {
    const config = PluginConfigV003Schema.parse(makeConfig(undefined));
    expect(() => validateToggles(config)).not.toThrow();
  });
});

// parseConfigV003 integration with validateToggles — needs filesystem
// so we skip the full integration here (covered by other integration tests).
// Just verify that the schema validation pipeline accepts the schema.

describe('PluginConfigV003Schema integration with config.ts', () => {
  it('schema accepts the same shape parseConfigV003 uses', () => {
    // Sanity: parseConfigV003 uses PluginConfigV003Schema.parse(rawJson).
    // We verify that what validateToggles expects (toggles field) is
    // always present after parsing.
    const parsed = PluginConfigV003Schema.parse(makeConfig(undefined));
    expect(parsed.toggles).toBeDefined();
    expect(typeof parsed.toggles.toolDelivery).toBe('boolean');
  });
});

// Reference parseConfigV003 to avoid unused import warnings
void parseConfigV003;
