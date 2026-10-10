import {describe, expect, it} from 'vitest';
import {loadCatalog} from './catalog.ts';

const SNAPSHOT = {
  generatedAt: '2026-10-10T00:00:00Z',
  entries: [
    {
      id: 'a',
      name: 'A',
      place: 'Here',
      url: 'https://a.test/a.zip',
      originalUrl: null,
      access: {kind: 'direct'},
      license: null,
      bbox: null,
      featured: true,
      viaMobilityDatabase: false,
    },
  ],
};

describe('loadCatalog', () => {
  it('requests /catalog.json and returns the parsed snapshot', async () => {
    const urls: string[] = [];
    const snapshot = await loadCatalog(async (url) => {
      urls.push(url);
      return Response.json(SNAPSHOT);
    });
    expect(urls).toEqual(['/catalog.json']);
    expect(snapshot).toEqual(SNAPSHOT);
  });

  it('rejects on an HTTP error', async () => {
    await expect(loadCatalog(async () => new Response('x', {status: 500}))).rejects.toThrow('HTTP 500');
  });
});
