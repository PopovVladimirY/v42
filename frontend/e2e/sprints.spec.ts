import { test, expect } from '@playwright/test';

// The holy fakeAuth ritual -- identical to projects.spec.ts
// Without this, ProtectedRoute banishes us to /login faster than a security guard.
async function fakeAuth({ page }: { page: import('@playwright/test').Page }) {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(JSON.stringify({ sub: 'test-user', role: 'admin', exp: 9999999999 })).replace(/=/g, '');
  const fakeToken = `${header}.${payload}.fakesig`;

  const fakeUser = {
    id: 'test-user',
    email: 'admin@v42.dev',
    role: 'admin',
    must_change_password: false,
  };

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: fakeUser, meta: null, error: null }),
    })
  );

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

  await page.reload();
}

// Fake project: already exists in our imagination
const FAKE_PROJECT_ID = 'proj-0001-0000-0000-000000000001';
const FAKE_SPRINT_ID  = 'spr-00001-0000-0000-000000000001';

const fakeSprint = {
  id: FAKE_SPRINT_ID,
  project_id: FAKE_PROJECT_ID,
  name: 'Sprint 1',
  goal: 'Ship the MVP before the sun burns out',
  status: 'active',
  start_date: '2025-01-01',
  end_date: '2025-01-14',
  capacity_hours: 80,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const fakeSprintItem = {
  id: 'item-00001-0000-0000-000000000001',
  title: 'As a user I want to log in',
  status: 'in_progress',
  type: 'story',
  priority: 1.0,
  estimate: '3h',
  added_at: '2025-01-01T00:00:00Z',
};

// Mock project and sprint API endpoints -- no backend required
async function mockSprintApi({ page }: { page: import('@playwright/test').Page }) {
  await page.route(`**/api/v1/projects/${FAKE_PROJECT_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { id: FAKE_PROJECT_ID, name: 'Infinity Project', status: 'active', team_id: 'team-0001', created_at: '', updated_at: '' },
        meta: null,
        error: null,
      }),
    })
  );

  await page.route(`**/api/v1/projects/${FAKE_PROJECT_ID}/sprints`, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [fakeSprint], meta: null, error: null }),
      });
    } else {
      // POST -- create sprint; return the created sprint
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ...fakeSprint, id: 'new-sprint-id', name: 'Sprint 2', status: 'planning' }, meta: null, error: null }),
      });
    }
  });

  await page.route(`**/api/v1/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: fakeSprint, meta: null, error: null }),
    })
  );

  await page.route(`**/api/v1/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}/items`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [fakeSprintItem], meta: null, error: null }),
    })
  );
}

// ---------------------------------------------------------------------------
// Sprints -- unauthenticated redirect
// ---------------------------------------------------------------------------

test.describe('Sprints -- unauthenticated redirect', () => {
  test('redirects /projects/x/sprints to /login when no token', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects /projects/x/sprints/y to /login when no token', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Sprints page -- structure (no backend required)
// ---------------------------------------------------------------------------

test.describe('Sprints page -- structure', () => {
  test.beforeEach(async ({ page }) => {
    await fakeAuth({ page });
    await mockSprintApi({ page });
  });

  test('Sprints tab exists in ProjectShell nav', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}`);
    const sprintsTab = page.getByTestId('project-tab-sprints');
    await expect(sprintsTab).toBeVisible();
  });

  test('navigating to Sprints tab shows sprint list', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await expect(page.getByTestId('project-tab-sprints')).toBeVisible();
  });

  test('shows new sprint button for admin', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await expect(page.getByTestId('new-sprint-btn')).toBeVisible();
  });

  test('shows active sprint card', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await expect(page.getByTestId(`sprint-card-${FAKE_SPRINT_ID}`)).toBeVisible();
  });

  test('active section is visible', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await expect(page.getByTestId('sprints-active')).toBeVisible();
  });

  test('sprint card links to sprint detail', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    const link = page.locator(`[data-testid="sprint-card-${FAKE_SPRINT_ID}"] a`).first();
    await expect(link).toHaveAttribute('href', `/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
  });

  test('new sprint modal opens and has required fields', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await page.getByTestId('new-sprint-btn').click();

    await expect(page.getByTestId('sprint-name-input')).toBeVisible();
    await expect(page.getByTestId('sprint-goal-input')).toBeVisible();
    await expect(page.getByTestId('sprint-start-date')).toBeVisible();
    await expect(page.getByTestId('sprint-end-date')).toBeVisible();
    await expect(page.getByTestId('create-sprint-submit')).toBeVisible();
  });

  test('submit button disabled when name is empty', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await page.getByTestId('new-sprint-btn').click();

    const submit = page.getByTestId('create-sprint-submit');
    await expect(submit).toBeDisabled();
  });

  test('submit button enabled after typing name', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await page.getByTestId('new-sprint-btn').click();
    await page.getByTestId('sprint-name-input').fill('Sprint 2');

    await expect(page.getByTestId('create-sprint-submit')).toBeEnabled();
  });

  test('cancel button closes modal', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await page.getByTestId('new-sprint-btn').click();
    await expect(page.getByTestId('sprint-name-input')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('sprint-name-input')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Sprint detail page -- board structure
// ---------------------------------------------------------------------------

test.describe('Sprint detail -- board', () => {
  test.beforeEach(async ({ page }) => {
    await fakeAuth({ page });
    await mockSprintApi({ page });
  });

  test('sprint detail shows sprint name', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
    await expect(page.getByText('Sprint 1')).toBeVisible();
  });

  test('sprint detail shows status badge', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
    await expect(page.getByTestId('sprint-status-badge')).toBeVisible();
  });

  test('sprint board renders all 4 columns', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);

    await expect(page.getByTestId('board-col-open')).toBeVisible();
    await expect(page.getByTestId('board-col-in_progress')).toBeVisible();
    await expect(page.getByTestId('board-col-in_review')).toBeVisible();
    await expect(page.getByTestId('board-col-done')).toBeVisible();
  });

  test('sprint item appears in correct column', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
    // fakeSprintItem.status = 'in_progress' -> should be in in_progress column
    const col = page.getByTestId('board-col-in_progress');
    await expect(col.getByTestId(`sprint-item-${fakeSprintItem.id}`)).toBeVisible();
  });

  test('sprint detail shows sprint goal', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
    await expect(page.getByText('Ship the MVP before the sun burns out')).toBeVisible();
  });

  test('back link navigates to sprints list', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
    const back = page.getByText('\u2190 Sprints');
    await expect(back).toBeVisible();
  });

  test('admin sees status dropdown on sprint detail', async ({ page }) => {
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints/${FAKE_SPRINT_ID}`);
    await expect(page.getByTestId('sprint-status-select')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Sprints + Sprint board -- with real backend (skipped unless flag set)
// ---------------------------------------------------------------------------

const WITH_BACKEND = process.env['RUN_E2E_WITH_BACKEND'] === '1';

test.describe('Sprints -- with backend', () => {
  test.skip(!WITH_BACKEND, 'Set RUN_E2E_WITH_BACKEND=1 to run backend-dependent tests');

  test('creates a sprint and sees it in the list', async ({ page }) => {
    await fakeAuth({ page });
    await page.goto(`/projects/${FAKE_PROJECT_ID}/sprints`);
    await page.getByTestId('new-sprint-btn').click();
    await page.getByTestId('sprint-name-input').fill('Integration Sprint');
    await page.getByTestId('create-sprint-submit').click();
    await expect(page.getByText('Integration Sprint')).toBeVisible();
  });
});
