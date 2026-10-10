import {expect, type BrowserContext, type Page} from '@playwright/test';
import {makeZip, SAMPLE_FEED, TRANSLATED_FEED} from '../src/test-fixtures/sample-feed.ts';

export const CATALOG_BASE = 'https://catalog.test';
const CORS = {'access-control-allow-origin': '*'};

export function sampleZip(): Buffer {
  return Buffer.from(makeZip(SAMPLE_FEED));
}

export interface MockCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly zip: Buffer;
}

/** Serves catalog.json, catalog.lock.json, and feed zips for the fake catalog origin. */
export async function mockCatalog(context: BrowserContext, entries: readonly MockCatalogEntry[]): Promise<void> {
  const catalog = entries.map((e) => ({
    id: e.id,
    name: e.name,
    region: e.region,
    sourceUrl: `https://agency.test/${e.id}.zip`,
  }));
  const lock = {
    generatedAt: '2026-10-09T00:00:00Z',
    feeds: Object.fromEntries(
      entries.map((e) => [
        e.id,
        {sha256: `sha-${e.id}`, size: e.zip.length, fetchedAt: '2026-10-09T00:00:00Z', lastError: null, lastErrorAt: null},
      ]),
    ),
  };
  await context.route(`${CATALOG_BASE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/catalog.json') return route.fulfill({json: catalog, headers: CORS});
    if (path === '/catalog.lock.json') return route.fulfill({json: lock, headers: CORS});
    const entry = entries.find((e) => path === `/feeds/${e.id}.zip`);
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
