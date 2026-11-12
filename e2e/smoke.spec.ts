import { expect, type Page, test } from '@playwright/test';
import { ADMIN } from './admin.ts';

const mainNav = (page: Page) => page.locator('header.globalnav nav.globalnav-inner');

test.describe('login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('wrong password shows an error, the admin user gets in', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.login .message.bad')).toHaveText('Invalid username or password');

    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: `Log out ${ADMIN.username}` })).toBeVisible();
  });
});

test('the Brazilian flag switches to Portuguese and survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(mainNav(page).getByRole('link', { name: 'Work', exact: true })).toBeVisible();
  await mainNav(page).getByRole('button', { name: 'Português' }).click();
  await expect(mainNav(page).getByRole('link', { name: 'Trabalho', exact: true })).toBeVisible();

  await page.reload();
  await expect(mainNav(page).getByRole('link', { name: 'Trabalho', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('agentcowork.locale'))).toBe('pt-BR');
});

test('the theme button toggles light and dark and survives a reload', async ({ page }) => {
  const html = page.locator('html');
  await page.goto('/');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await mainNav(page).locator('.theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('agentcowork.theme'))).toBe('dark');
  await mainNav(page).locator('.theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the ☰ menu holds the groups and log out, and nothing overflows sideways', async ({ page }) => {
    await page.goto('/#/runs');
    const toggle = page.locator('.menu-toggle');
    await expect(toggle).toBeVisible();
    await expect(mainNav(page).locator('a.group').first()).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await toggle.click();
    const menu = page.locator('#mobile-menu');
    for (const group of ['Home', 'Work', 'Team', 'Setup']) await expect(menu.getByRole('link', { name: group, exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: `Log out ${ADMIN.username}` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('leaving a settings form with unsaved changes asks first', async ({ page }) => {
  await page.goto('/#/agents/developer/settings');
  const box = page.locator('main .card').getByRole('checkbox', { name: 'First reviewer' });
  const before = await box.isChecked();
  await box.click();

  page.once('dialog', (d) => d.dismiss());
  await page.evaluate(() => (window.location.hash = '#/runs'));
  await expect(page).toHaveURL(/#\/agents\/developer\/settings$/);
  await expect(box).toBeChecked({ checked: !before });

  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => (window.location.hash = '#/runs'));
  await expect(page).toHaveURL(/#\/runs$/);
  await expect(page.locator('.subnav a[aria-current="page"]')).toHaveText('Runs');
});

test('every top-level page renders without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  const paths = ['', 'inbox', 'runs', 'findings', 'brain', 'agents', 'agents/developer', 'projects', 'accounts', 'general', 'instructions', 'usage', 'activity'];
  for (const path of paths) {
    await test.step(`#/${path}`, async () => {
      await page.goto(`/#/${path}`);
      await expect(page.locator('main.content')).not.toBeEmpty();
      await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toHaveCount(0);
      await expect(page.locator('main .load-error')).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText('Page not found.');
      expect(errors, `errors on #/${path}`).toEqual([]);
    });
  }
});
