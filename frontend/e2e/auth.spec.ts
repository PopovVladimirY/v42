import { test, expect } from '@playwright/test';

// These tests run against the real Vite dev server (mocked auth not needed
// for redirect/form tests -- only login success requires a running backend).

test.describe('Auth -- unauthenticated', () => {
  test('redirects / to /login when no token', async ({ page }) => {
    // Navigate to login first so localStorage is accessible, then clear and re-navigate
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('v42-auth'));
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('login page renders form elements', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Пароль')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  });

  test('shows validation error on empty submit', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Некорректный email')).toBeVisible();
  });

  test('shows validation error on invalid email', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Пароль').fill('pass');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Некорректный email')).toBeVisible();
  });
});

// Auth success tests require the Go backend + DB to be running.
// Run with: RUN_E2E_WITH_BACKEND=1 npm run test:e2e
test.describe('Auth -- with backend', () => {
  test.skip(!process.env.RUN_E2E_WITH_BACKEND, 'Requires backend. Set RUN_E2E_WITH_BACKEND=1.');

  test('logs in and redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL ?? 'admin@v42.dev');
    await page.getByLabel('Пароль').fill(process.env.E2E_ADMIN_PASSWORD ?? 'changeme');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL('/');
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page).toHaveURL('/login');
  });
});
