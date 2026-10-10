import {expect, type BrowserContext, type Page} from '@playwright/test';
import {makeZip, SAMPLE_FEED, TRANSLATED_FEED} from '../src/test-fixtures/sample-feed.ts';

const CORS = {'access-control-allow-origin': '*'};

export function sampleZip(): Buffer {
  return Buffer.from(makeZip(SAMPLE_FEED));
}

export interface MockCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly place: string;
  readonly zip: Buffer;
}

/** Serves /catalog.json from the app's own origin and the feed zips from https://feeds.test. */
export async function mockCatalog(context: BrowserContext, entries: readonly MockCatalogEntry[]): Promise<void> {
  const snapshot = {
    generatedAt: '2026-10-10T00:00:00Z',
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      place: e.place,
      url: `https://feeds.test/${e.id}.zip`,
      originalUrl: null,
      access: {kind: 'direct'},
      license: null,
      bbox: null,
      featured: true,
      viaMobilityDatabase: false,
    })),
  };
  await context.route('**/catalog.json', (route) => route.fulfill({json: snapshot}));
  await context.route('https://feeds.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const entry = entries.find((e) => path === `/${e.id}.zip`);
    if (entry !== undefined) {
      return route.fulfill({body: entry.zip, contentType: 'application/zip', headers: CORS});
    }
    return route.fulfill({status: 404, headers: CORS});
  });
}

export async function uploadSample(page: Page): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({
    name: 'demo-transit.zip',
    mimeType: 'application/zip',
    buffer: sampleZip(),
  });
  await expect(page).toHaveURL(/feed=file-demo-transit/, {timeout: 30_000});
  await expect(page.locator('aside').getByRole('heading', {name: 'Routes'})).toBeVisible();
}

export async function uploadTranslatedSample(page: Page): Promise<void> {
  await page.getByTestId('file-input').setInputFiles({
    name: 'demo-translated.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(makeZip(TRANSLATED_FEED)),
  });
  await expect(page).toHaveURL(/feed=file-demo-translated/, {timeout: 30_000});
  await expect(page.locator('aside').getByRole('heading', {name: 'Routes'})).toBeVisible();
}

export interface FakeMapState {
  readonly filters: Record<string, unknown>;
  readonly opacity: Record<string, number>;
  readonly fitBoundsCount: number;
  readonly language: string | null;
  readonly lightSetting: string;
}

export async function fakeMapState(page: Page): Promise<FakeMapState> {
  const raw = await page.getByTestId('fake-map').getAttribute('data-state');
  return JSON.parse(raw ?? '{}');
}
