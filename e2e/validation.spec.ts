import {expect, test} from '@playwright/test';
import {mockCatalog, uploadSample, uploadValidSample} from './helpers.ts';

test.beforeEach(async ({context}) => {
  await mockCatalog(context, []);
});

test('reports sample feed issues and links to the affected route', async ({page}) => {
  await page.goto('/');
  await uploadSample(page);
  const sidebar = page.locator('aside');
  await sidebar.getByText('Feed details').click();
  await expect(sidebar.getByText(/\d+ warnings?/)).toBeVisible({timeout: 30_000});
  await sidebar.getByRole('button', {name: 'View report'}).click();
  await expect(page).toHaveURL(/view=issues/);
  await expect(sidebar.getByRole('heading', {name: 'Feed issues'})).toBeVisible();
  const warnings = sidebar.getByRole('region', {name: 'Warnings'});
  await warnings.getByText('Unrealistic speed (2)').click();
  await warnings.getByRole('button', {name: 'Open route 10'}).first().click();
  await expect(page).toHaveURL(/route=R10/);
  await expect(page).not.toHaveURL(/view=issues/);
  await expect(sidebar.getByRole('region', {name: 'Issues'}).getByRole('heading', {name: 'Issues (2)'})).toBeVisible();
  await page.goBack();
  await expect(sidebar.getByRole('heading', {name: 'Feed issues'})).toBeVisible();
});

test('says a valid feed has no issues', async ({page}) => {
  await page.goto('/');
  await uploadValidSample(page);
  await page.locator('aside').getByText('Feed details').click();
  await expect(page.locator('aside').getByText('No issues found')).toBeVisible({timeout: 30_000});
});
