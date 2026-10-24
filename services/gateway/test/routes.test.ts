/**
 * Contract test: every operation documented in openapi.yaml must be routed by
 * the gateway to a service, with an access level matching its documented
 * security – so the docs and the edge can never drift apart.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { matchRoute } from '../src/routes.js';

const specPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../openapi.yaml');
const spec = parse(readFileSync(specPath, 'utf8')) as { paths: Record<string, Record<string, { security?: unknown; summary?: string }>> };
const SAMPLE_ID = '6c1f1e0e-6a3b-4c43-9a51-2b1f3f2c9e10';

for (const [specPathTemplate, operations] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(operations)) {
    test(`${method.toUpperCase()} ${specPathTemplate} is routed with matching access`, () => {
      const url = `/api/v1${specPathTemplate.replace('{id}', SAMPLE_ID)}`;
      const route = matchRoute(method.toUpperCase(), url);
      assert.ok(route, `no gateway route for ${method.toUpperCase()} ${url}`);
      const documentedPublic = !operation.security;
      assert.equal(route.access === 'public', documentedPublic, `access mismatch: gateway=${route.access}`);
      if (operation.summary?.includes('🛡️')) assert.equal(route.access, 'admin');
    });
  }
}

test('internal endpoints are never exposed', () => {
  assert.equal(matchRoute('PUT', `/api/v1/internal/inventory/${SAMPLE_ID}`), undefined);
  assert.equal(matchRoute('PUT', `/internal/inventory/${SAMPLE_ID}`), undefined);
});
