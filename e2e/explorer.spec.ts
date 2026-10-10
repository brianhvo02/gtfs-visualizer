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
  await mockCatalog(context, [{id: 'demo-catalog', name: 'Demo Catalog Feed', region: 'Testland', zip: sampleZip()}]);
  await page.goto('/');
  await page.getByRole('button', {name: 'Import Demo Catalog Feed'}).click();
  await expect(page).toHaveURL(/feed=demo-catalog/, {timeout: 30_000});
  await page.getByRole('button', {name: 'Change feed'}).click();
  await expect(page.locator('.feed-list').getByRole('button', {name: 'Demo Catalog Feed', exact: true})).toBeVisible();
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
