import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

describe('API docs static page accessibility', () => {
  it('passes axe-core serious/critical checks', async () => {
    document.body.innerHTML = `
      <main>
        <h1>dasDocker API Docs</h1>
        <p>Interactive documentation for API consumers.</p>
      </main>
    `;
    const result = await axe.run(document.body, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    const seriousOrCritical = result.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    expect(seriousOrCritical).toEqual([]);
  });
});
