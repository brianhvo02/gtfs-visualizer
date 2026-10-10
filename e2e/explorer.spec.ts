import {expect, test} from '@playwright/test';
import {fakeMapState, mockCatalog, sampleZip, uploadSample, uploadTranslatedSample} from './helpers.ts';

test.beforeEach(async ({context}) => {
  await mockCatalog(context, []);
});

test('imports an uploaded feed and highlights a selected route', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', {name: '10 · Airport - Central'}).click();
  await expect(page).toHaveURL(/route=R10/);
  await expect(sidebar.getByRole('heading', {name: '10 · Airport - Central'})).toBeVisible();
  await expect
    .poll(async () => (await fakeMapState(page)).filters['routes-highlight'])
    .toEqual({kind: 'eq', property: 'routeId', value: 'R10'});
  expect((await fakeMapState(page)).opacity['routes-line']).toBe(0.25);
});

test('selects a stop from the map and lists departures', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  await page.goto('/?feed=file-demo-transit&route=R10');
  await page.getByTestId('fake-map').locator('button[data-layer="stops-route"]', {hasText: 'Beatty Airport'}).click();
  await expect(page).toHaveURL(/stop=BEATTY/);
  await expect(page.locator('aside').getByRole('heading', {name: 'Beatty Airport'})).toBeVisible();
});

test('remembers the chosen map lighting across reloads', async ({page}) => {
  await page.goto('/');
  const lighting = page.getByRole('combobox', {name: 'Map lighting'});
  await expect(lighting).toHaveValue('auto');
  await expect.poll(async () => (await fakeMapState(page)).lightSetting).toBe('auto');
  await lighting.selectOption('dusk');
  await expect.poll(async () => (await fakeMapState(page)).lightSetting).toBe('dusk');
  await page.reload();
  await expect(page.getByRole('combobox', {name: 'Map lighting'})).toHaveValue('dusk');
  await expect.poll(async () => (await fakeMapState(page)).lightSetting).toBe('dusk');
});

test('shows a station’s departures for a date and restores the view on reload', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  await page.goto('/?feed=file-demo-transit&stop=STN&date=2026-10-12');
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('heading', {name: 'Central Station'})).toBeVisible();
  const rows = sidebar.getByRole('table', {name: 'Departures'}).locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('08:20');
  await expect(rows.last()).toContainText('00:20 +1');

  await page.reload();
  await expect(sidebar.getByRole('heading', {name: 'Central Station'})).toBeVisible();
  await expect(rows).toHaveCount(4);
});

test('explains a blocked URL download and suggests uploading', async ({page, context}) => {
  await context.route('https://blocked.test/**', (route) => route.abort('failed'));
  await page.goto('/');
  await page.getByLabel('Feed URL').fill('https://blocked.test/feed.zip');
  await page.getByRole('button', {name: 'Import URL'}).click();
  await expect(page.getByRole('alert')).toContainText('upload it instead');
});

test('imports a feed from the catalog', async ({page, context}) => {
  await context.unrouteAll();
  await mockCatalog(context, [{id: 'demo-catalog', name: 'Demo Catalog Feed', place: 'Testland', zip: sampleZip()}]);
  await page.goto('/');
  await page.getByRole('button', {name: 'Import Demo Catalog Feed'}).click();
  await expect(page).toHaveURL(/feed=demo-catalog/, {timeout: 30_000});
  await page.getByRole('button', {name: 'Change feed'}).click();
  await expect(page.locator('.feed-list').getByRole('button', {name: 'Demo Catalog Feed', exact: true})).toBeVisible();
});

const KEYED = {
  kind: 'key',
  provider: 'odpt',
  signupUrl: 'https://signup.test/odpt',
  queryParam: 'acl:consumerKey',
  header: null,
} as const;

test('imports a keyed feed, remembers the key per provider, and forgets it', async ({page, context}) => {
  await context.unrouteAll();
  await mockCatalog(context, [
    {id: 'keyed-one', name: 'Keyed Feed', place: 'Keyland', zip: sampleZip(), access: KEYED, validKey: 'secret'},
    {id: 'keyed-two', name: 'Other Keyed', place: 'Keyland', zip: sampleZip(), access: KEYED, validKey: 'secret'},
  ]);
  await page.goto('/');
  await expect(page.getByRole('link', {name: 'Get a key'}).first()).toHaveAttribute('href', 'https://signup.test/odpt');
  const field = page.getByLabel('API key for odpt').first();
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill('secret');
  await page.getByRole('button', {name: 'Save key and import Keyed Feed', exact: true}).click();
  await expect(page).toHaveURL(/feed=keyed-one/, {timeout: 30_000});
  expect(page.url()).not.toContain('secret');
  await page.getByRole('button', {name: 'Change feed'}).click();
  await expect(page.getByRole('button', {name: 'Forget key for odpt'}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: 'Import Other Keyed', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Forget key for odpt'}).first().click();
  await expect(page.getByLabel('API key for odpt')).toHaveCount(2);
});

test('a rejected key shows a message and asks for the key again', async ({page, context}) => {
  await context.unrouteAll();
  await mockCatalog(context, [
    {id: 'keyed-one', name: 'Keyed Feed', place: 'Keyland', zip: sampleZip(), access: KEYED, validKey: 'secret'},
  ]);
  await page.goto('/');
  await page.getByLabel('API key for odpt').fill('wrong');
  await page.getByRole('button', {name: 'Save key and import Keyed Feed', exact: true}).click();
  await expect(page.getByText('The provider rejected this key.')).toBeVisible();
  await expect(page.getByLabel('API key for odpt')).toBeVisible();
});

test('falls back to download instructions when the browser blocks the feed', async ({page, context}) => {
  await context.unrouteAll();
  await mockCatalog(context, [
    {
      id: 'blocked-one',
      name: 'Blocked Feed',
      place: 'Walled City',
      zip: sampleZip(),
      blockDirect: true,
      originalUrl: 'https://agency.test/gtfs',
    },
  ]);
  await page.goto('/');
  await page.getByRole('button', {name: 'Import Blocked Feed', exact: true}).click();
  await expect(page.getByRole('link', {name: 'Download Blocked Feed'})).toHaveAttribute(
    'href',
    'https://agency.test/gtfs',
  );
  await page.getByLabel('Upload downloaded file for Blocked Feed').setInputFiles({
    name: 'whatever.zip',
    mimeType: 'application/zip',
    buffer: sampleZip(),
  });
  await expect(page).toHaveURL(/feed=blocked-one/, {timeout: 30_000});
  await page.getByRole('button', {name: 'Change feed'}).click();
  await expect(page.locator('.feed-list').getByRole('button', {name: 'Blocked Feed', exact: true})).toBeVisible();
});

test('searches the whole catalog across scripts', async ({page, context}) => {
  await context.unrouteAll();
  await mockCatalog(context, [
    {id: 'akashi', name: '明石市 — たこバス', place: 'Akashi, Hyogo Prefecture, JP', zip: sampleZip(), featured: false},
    {id: 'other', name: 'Other Transit', place: 'Elsewhere', zip: sampleZip(), featured: false},
  ]);
  await page.goto('/');
  const search = page.getByRole('searchbox', {name: 'Search feeds'});
  await search.fill('明石');
  await expect(page.getByRole('button', {name: 'Import 明石市 — たこバス'})).toBeVisible();
  await search.fill('akashi');
  await expect(page.getByRole('button', {name: 'Import 明石市 — たこバス'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Import Other Transit'})).toHaveCount(0);
  await search.fill('   ');
  await expect(page.getByRole('button', {name: 'Import 明石市 — たこバス'})).toHaveCount(0);
  await expect(page.getByText(/Showing/)).toHaveCount(0);
});

test('flags a saved catalog feed when the provider has a newer version', async ({page, context}) => {
  await context.unrouteAll();
  const catalog = await mockCatalog(context, [
    {id: 'demo-catalog', name: 'Demo Catalog Feed', place: 'Testland', zip: sampleZip(), etag: '"v1"'},
  ]);
  await page.goto('/');
  await page.getByRole('button', {name: 'Import Demo Catalog Feed'}).click();
  await expect(page).toHaveURL(/feed=demo-catalog/, {timeout: 30_000});
  await page.getByRole('button', {name: 'Change feed'}).click();
  await expect(page.locator('.feed-list').getByRole('button', {name: 'Demo Catalog Feed', exact: true})).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Update available')).toHaveCount(0);

  catalog.setEtag('demo-catalog', '"v2"');
  await page.goto('/');
  await expect(page.getByText('Update available')).toBeVisible();
});

test('explains deep links to missing feeds and routes', async ({page}) => {
  await page.goto('/?feed=nope');
  await expect(page.getByRole('status')).toContainText("isn't saved in this browser");
  await expect(page).not.toHaveURL(/feed=/);

  await uploadSample(page);
  await page.goto('/?feed=file-demo-transit&route=NOPE');
  await expect(page.getByText('Route not found in this feed.')).toBeVisible();
});

test('a second tab can take over from the first', async ({context}) => {
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.getByRole('heading', {name: 'Choose a feed'})).toBeVisible();

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText('already open in another tab')).toBeVisible();
  await second.getByRole('button', {name: 'Take over'}).click();
  await expect(second.getByRole('heading', {name: 'Choose a feed'})).toBeVisible({timeout: 15_000});
  await expect(first.getByText('opened in another tab')).toBeVisible();
});

test('shows a feed in a chosen language and keeps it on reload', async ({page}) => {
  await page.goto('/');
  await uploadTranslatedSample(page);
  const language = page.getByRole('combobox', {name: 'Language'});
  await expect(language).toHaveValue('original');
  await expect.poll(async () => (await fakeMapState(page)).language).toBe('en');
  const fitsBefore = (await fakeMapState(page)).fitBoundsCount;
  await language.selectOption('fr');
  await expect(page).toHaveURL(/lang=fr/);
  await expect.poll(async () => (await fakeMapState(page)).language).toBe('fr');
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('button', {name: '10 · Aéroport - Centre'})).toBeVisible();
  expect((await fakeMapState(page)).fitBoundsCount).toBe(fitsBefore);
  await expect(sidebar.locator('.feed-name')).toHaveText('Régie de transport démo');
  await page.reload();
  await expect(page.getByRole('combobox', {name: 'Language'})).toHaveValue('fr');
  await expect(sidebar.getByRole('button', {name: '10 · Aéroport - Centre'})).toBeVisible();
});

test('keeps the route detail view mounted when the language changes', async ({page}) => {
  await page.goto('/');
  await uploadTranslatedSample(page);
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', {name: /^10 ·/}).click();
  const pattern = sidebar.getByRole('combobox', {name: 'Pattern'});
  const options = await pattern.locator('option').evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
  expect(options.length).toBeGreaterThan(1);
  await pattern.selectOption(options[1] ?? '');
  await page.getByRole('combobox', {name: 'Language'}).selectOption('fr');
  await expect(sidebar.getByRole('heading', {name: /Aéroport - Centre/})).toBeVisible();
  await expect(pattern).toHaveValue(options[1] ?? '');
  await expect(sidebar.getByRole('button', {name: '← All routes'})).toBeVisible();
});

test('keeps a language the feed lacks in the URL while showing original names', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  await page.goto('/?feed=file-demo-transit&lang=fr');
  const sidebar = page.locator('aside');
  await sidebar.getByRole('button', {name: '10 · Airport - Central'}).click();
  await expect(page).toHaveURL(/route=R10/);
  await expect(page).toHaveURL(/lang=fr/);
  await expect(sidebar.getByRole('heading', {name: '10 · Airport - Central'})).toBeVisible();
});

test('has no language selector for a feed without translations', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  await expect(page.getByRole('combobox', {name: 'Language'})).toHaveCount(0);
});
