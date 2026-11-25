import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('deployment and data-boundary configuration', () => {
  it('pins Vercel functions to the supported Node 22 runtime', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    expect(config.functions['api/**/*.ts'].runtime).toBe('nodejs22.x');
  });
  it('enables RLS and owner predicates for every project data table', () => {
    const schema = readFileSync(resolve(process.cwd(), 'supabase/schema.sql'), 'utf8');
    for (const table of ['projects', 'project_documents', 'gis_drafts']) {
      expect(schema).toContain(`alter table public.${table} enable row level security`);
    }
    expect(schema.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(6);
  });
  it('does not ship privileged database or AppDeploy credentials in the browser client', () => {
    const client = readFileSync(resolve(process.cwd(), 'client.ts'), 'utf8');
    expect(client).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(client.toLowerCase()).not.toContain('appdeploy');
  });
});
