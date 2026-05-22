import { test, expect } from '@playwright/test';

// Helper: inject a fake auth token so ProtectedRoute lets us through.
// No real backend needed for redirect / structure tests.
// Zustand persist stores: { state: { accessToken, user }, version: 0 }
async function fakeAuth({ page }: { page: import('@playwright/test').Page }) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify({ sub: 'test-user', role: 'admin', exp: 9999999999 })).replace(/=/g, '');
  const fakeToken = `${header}.${payload}.fakesig`;

  const fakeUser = { id: 'test-user', email: 'admin@v42.dev', role: 'admin', must_change_password: false };

  // Mock the /auth/me endpoint so ProtectedRoute's loadMe() doesn't call clear().
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: fakeUser, meta: null, error: null }),
    })
  );

  // Also mock the /auth/refresh endpoint to prevent spurious 401 cascades.
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { access_token: fakeToken }, meta: null, error: null }),
    })
  );

  await page.goto('/login');

  await page.evaluate(
    ([token, user]) => {
      const zustandState = JSON.stringify({ state: { accessToken: token, user }, version: 0 });
      localStorage.setItem('v42-auth', zustandState);
    },
    [fakeToken, fakeUser] as const
  );

  // Reload so Zustand rehydrates from the patched localStorage.
  await page.reload();
}

// ---------------------------------------------------------------------------
// Projects page -- unauthenticated
// ---------------------------------------------------------------------------

test.describe('Projects -- unauthenticated redirect', () => {
  test('redirects /teams/x/projects to /login when no token', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('v42-auth'));
    await page.goto('/teams/fake-id/projects');
    await expect(page).toHaveURL('/login');
  });

  test('redirects /projects/x to /login when no token', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('v42-auth'));
    await page.goto('/projects/fake-id');
    await expect(page).toHaveURL('/login');
  });

  test('redirects /projects/x/backlog to /login when no token', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('v42-auth'));
    await page.goto('/projects/fake-id/backlog');
    await expect(page).toHaveURL('/login');
  });

  test('redirects /projects/x/epics to /login when no token', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('v42-auth'));
    await page.goto('/projects/fake-id/epics');
    await expect(page).toHaveURL('/login');
  });
});

// ---------------------------------------------------------------------------
// Projects page -- structure (no backend, uses fake token)
// ---------------------------------------------------------------------------

test.describe('Projects page -- structure', () => {
  test.beforeEach(fakeAuth);

  test('projects page renders empty state for unknown team', async ({ page }) => {
    // Will fail to fetch but still render the page shell.
    await page.goto('/teams/00000000-0000-0000-0000-000000000000/projects');
    // New Project button should be visible for admin role.
    await expect(page.getByTestId('new-project-btn')).toBeVisible({ timeout: 5000 });
  });

  test('project shell renders tab navigation', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000');
    // Tab nav should appear regardless of data load outcome.
    await expect(page.getByTestId('project-tab-overview')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('project-tab-backlog')).toBeVisible();
    await expect(page.getByTestId('project-tab-epics')).toBeVisible();
    await expect(page.getByTestId('project-tab-sprints')).toBeVisible();
  });

  test('backlog tab renders filter bar', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000/backlog');
    await expect(page.getByTestId('filter-status')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('filter-clarity')).toBeVisible();
    await expect(page.getByTestId('add-item-btn')).toBeVisible();
  });

  test('epics tab renders add button', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000/epics');
    await expect(page.getByTestId('add-epic-btn')).toBeVisible({ timeout: 5000 });
  });

  test('new project modal opens and closes', async ({ page }) => {
    await page.goto('/teams/00000000-0000-0000-0000-000000000000/projects');
    await page.getByTestId('new-project-btn').click();
    await expect(page.getByTestId('project-name-input')).toBeVisible();
    // Close via Cancel button.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('project-name-input')).not.toBeVisible();
    // Reopen and check again.
    await page.getByTestId('new-project-btn').click();
    await expect(page.getByTestId('project-name-input')).toBeVisible();
  });

  test('new project form submit is disabled when title is empty', async ({ page }) => {
    await page.goto('/teams/00000000-0000-0000-0000-000000000000/projects');
    await page.getByTestId('new-project-btn').click();
    const submitBtn = page.getByTestId('create-project-submit');
    await expect(submitBtn).toBeDisabled();
    await page.getByTestId('project-name-input').fill('My test project');
    await expect(submitBtn).not.toBeDisabled();
  });

  test('add item panel opens in backlog', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000/backlog');
    await page.getByTestId('add-item-btn').click();
    await expect(page.getByTestId('new-item-title')).toBeVisible();
    await expect(page.getByTestId('new-item-type')).toBeVisible();
    await expect(page.getByTestId('new-item-submit')).toBeDisabled();
    await page.getByTestId('new-item-title').fill('Test story');
    await expect(page.getByTestId('new-item-submit')).not.toBeDisabled();
  });

  test('add epic panel opens with correct fields', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000/epics');
    await page.getByTestId('add-epic-btn').click();
    await expect(page.getByTestId('new-epic-title')).toBeVisible();
    await expect(page.getByTestId('new-epic-desc')).toBeVisible();
    await expect(page.getByTestId('new-epic-submit')).toBeDisabled();
    await page.getByTestId('new-epic-title').fill('Some epic');
    await expect(page.getByTestId('new-epic-submit')).not.toBeDisabled();
  });

  test('team detail page has projects link', async ({ page }) => {
    await page.goto('/teams/00000000-0000-0000-0000-000000000000');
    await expect(page.getByTestId('team-projects-link')).toBeVisible({ timeout: 5000 });
  });

  test('projects link navigates to projects page', async ({ page }) => {
    await page.goto('/teams/00000000-0000-0000-0000-000000000000');
    await page.getByTestId('team-projects-link').click();
    await expect(page).toHaveURL('/teams/00000000-0000-0000-0000-000000000000/projects');
  });
});

// ---------------------------------------------------------------------------
// Projects + Backlog -- full backend flow
// ---------------------------------------------------------------------------

test.describe('Projects + Backlog -- with backend', () => {
  test.skip(!process.env.RUN_E2E_WITH_BACKEND, 'Requires backend. Set RUN_E2E_WITH_BACKEND=1.');

  const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@v42.dev';
  const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD ?? 'changeme';

  async function login(page: import('@playwright/test').Page) {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/teams');
  }

  test('create project and navigate to it', async ({ page }) => {
    await login(page);
    // Go to first team.
    await page.getByRole('link').first().click();
    const teamId = page.url().split('/teams/')[1];
    await page.goto(`/teams/${teamId}/projects`);

    await page.getByTestId('new-project-btn').click();
    await page.getByTestId('project-name-input').fill('E2E Test Project');
    await page.getByTestId('project-desc-input').fill('Created by the mad monkey');
    await page.getByTestId('create-project-submit').click();

    // Should see the new project card.
    await expect(page.getByText('E2E Test Project')).toBeVisible({ timeout: 5000 });
  });

  test('backlog: add item, change status, delete', async ({ page }) => {
    await login(page);

    // Navigate to first project's backlog.
    await page.goto('/teams');
    await page.getByRole('link').first().click();
    const teamId = page.url().split('/teams/')[1];
    await page.goto(`/teams/${teamId}/projects`);

    // Click first project card.
    const firstCard = page.getByTestId(/^project-card-/).first();
    const projectHref = await firstCard.getAttribute('href');
    await firstCard.click();
    await page.getByTestId('project-tab-backlog').click();

    // Add item.
    await page.getByTestId('add-item-btn').click();
    await page.getByTestId('new-item-title').fill('E2E backlog item');
    await page.getByTestId('new-item-submit').click();

    // Find the row.
    await expect(page.getByText('E2E backlog item')).toBeVisible({ timeout: 5000 });

    // Change status via inline pill.
    const row = page.locator('[data-testid^="backlog-row-"]').filter({ hasText: 'E2E backlog item' });
    const statusPill = row.locator('[data-testid^="status-pill-"]');
    await statusPill.click();
    await page.getByTestId('status-opt-ready').click();
    // Re-render should show updated status.
    await expect(statusPill).toHaveText('Ready', { timeout: 5000 });

    // Delete.
    const deleteBtn = row.locator('[data-testid^="delete-item-"]');
    page.once('dialog', (d) => d.accept());
    await deleteBtn.click();
    await expect(page.getByText('E2E backlog item')).not.toBeVisible({ timeout: 5000 });
  });

  test('epics: create, rename, delete', async ({ page }) => {
    await login(page);

    await page.goto('/teams');
    await page.getByRole('link').first().click();
    const teamId = page.url().split('/teams/')[1];
    await page.goto(`/teams/${teamId}/projects`);

    const firstCard = page.getByTestId(/^project-card-/).first();
    await firstCard.click();
    await page.getByTestId('project-tab-epics').click();

    // Create.
    await page.getByTestId('add-epic-btn').click();
    await page.getByTestId('new-epic-title').fill('E2E Epic Alpha');
    await page.getByTestId('new-epic-submit').click();
    await expect(page.getByText('E2E Epic Alpha')).toBeVisible({ timeout: 5000 });

    // Rename via click on title.
    const epicCard = page.locator('[data-testid^="epic-card-"]').filter({ hasText: 'E2E Epic Alpha' });
    await epicCard.getByTestId('epic-title').click();
    await epicCard.getByTestId('epic-title-input').fill('E2E Epic Alpha Renamed');
    await epicCard.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('E2E Epic Alpha Renamed')).toBeVisible({ timeout: 5000 });

    // Delete.
    const epicCardRenamed = page.locator('[data-testid^="epic-card-"]').filter({ hasText: 'E2E Epic Alpha Renamed' });
    page.once('dialog', (d) => d.accept());
    await epicCardRenamed.getByTestId(/^delete-epic-/).click();
    await expect(page.getByText('E2E Epic Alpha Renamed')).not.toBeVisible({ timeout: 5000 });
  });
});
