import {expect, type BrowserContext, type Page} from '@playwright/test';
import {makeZip, SAMPLE_FEED, TRANSLATED_FEED} from '../src/test-fixtures/sample-feed.ts';

const CORS = {'access-control-allow-origin': '*'};

export function sampleZip(): Buffer {
  return Buffer.from(makeZip(SAMPLE_FEED));
}

export type MockAccess =
  | {readonly kind: 'direct'}
  | {
      readonly kind: 'key';
      readonly provider: string;
      readonly signupUrl: string;
      readonly queryParam: string | null;
      readonly header: string | null;
    }
  | {readonly kind: 'download'; readonly pageUrl: string | null};

export interface MockCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly place: string;
  readonly zip: Buffer;
  readonly access?: MockAccess;
  readonly featured?: boolean;
  /** Served as the ETag on GET and HEAD. */
  readonly etag?: string;
  /** The zip request is aborted, as a browser does when CORS blocks it. */
  readonly blockDirect?: boolean;
  /** For keyed entries: the key the mock provider accepts (as the `acl:consumerKey` query parameter). */
  readonly validKey?: string;
  readonly originalUrl?: string;
}

export interface CatalogController {
  setEtag(id: string, etag: string): void;
}

/** Serves /catalog.json from the app's own origin and the feed zips from https://feeds.test. */
export async function mockCatalog(
  context: BrowserContext,
  entries: readonly MockCatalogEntry[],
): Promise<CatalogController> {
  const etags = new Map<string, string>();
  for (const e of entries) if (e.etag !== undefined) etags.set(e.id, e.etag);
  const snapshot = {
    generatedAt: '2026-10-10T00:00:00Z',
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      place: e.place,
      url: `https://feeds.test/${e.id}.zip`,
      originalUrl: e.originalUrl ?? null,
      access: e.access ?? {kind: 'direct'},
      license: null,
      bbox: null,
      featured: e.featured ?? true,
      viaMobilityDatabase: false,
    })),
  };
  await context.route('**/catalog.json', (route) => route.fulfill({json: snapshot}));
  await context.route('https://feeds.test/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = entries.find((e) => url.pathname === `/${e.id}.zip`);
    if (entry === undefined) return route.fulfill({status: 404, headers: CORS});
    if (entry.blockDirect === true) return route.abort('failed');
    if (entry.access?.kind === 'key' && url.searchParams.get('acl:consumerKey') !== entry.validKey) {
      return route.fulfill({status: 401, headers: CORS});
    }
    const etag = etags.get(entry.id);
    const headers: Record<string, string> = {...CORS, 'access-control-expose-headers': 'ETag'};
    if (etag !== undefined) headers['etag'] = etag;
    if (request.method() === 'HEAD') return route.fulfill({status: 200, headers});
    return route.fulfill({body: entry.zip, contentType: 'application/zip', headers});
  });
  return {setEtag: (id, etag) => void etags.set(id, etag)};
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
