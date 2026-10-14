import assert from 'node:assert/strict';

// Server env: VITE_SUPABASE_URL=https://test.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const users = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.com' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.com' },
].map(user => ({ ...user, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' }));
const password = 'test-password';
const sessionKey = 'sb-test-auth-token';
const token = user => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: user.role, exp: 4102444800 })).toString('base64url')}.test-signature`;
const session = user => ({ access_token: token(user), refresh_token: `refresh-${user.id}`, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user });
const rows = new Map(users.map((user, index) => [user.id, {
  version: 1,
  lastWriteId: null,
  data: {
    dailyTasks: [{ id: `habit-${index}`, title: index ? 'Bob private habit' : 'Alice private habit', isCompleted: false, lastCompletedDate: null, completionHistory: [] }],
    todos: [{ id: `seed-${index}`, title: index ? 'Bob cloud task' : 'Alice cloud task', isCompleted: false, createdAt: new Date('2024-02-29T12:00:00-08:00').getTime() }],
    notes: { '2024-02-29': index ? 'Bob private note' : 'Alice private note' },
  },
}]));
const mock = { loads: [], writes: [], passwordRequests: [], refreshes: 0, signups: 0, signupSession: false, logouts: 0, inFlight: 0, maxInFlight: 0, nextSave: null };
const conflict = 'Data changed in another tab or device. Export your changes before reloading.';
const json = (route, body, status = 200) => route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': '*' } });
const save = (body, user) => {
  assert.equal(body.expected_user, user.id);
  assert.ok(Number.isSafeInteger(body.expected_version));
  assert.match(body.request_id, /^[0-9a-f-]{36}$/);
  const row = rows.get(user.id);
  if (row.lastWriteId === body.request_id && row.version === body.expected_version + 1 && JSON.stringify(row.data) === JSON.stringify(body.payload)) return row.version;
  if (row.version !== body.expected_version) return null;
  row.data = structuredClone(body.payload);
  row.version++;
  row.lastWriteId = body.request_id;
  return row.version;
};
await page.route('https://test.supabase.co/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    return;
  }
  try {
    assert.equal(request.headers().apikey, 'test-public-key');
    const body = request.postDataJSON();
    if (url.pathname === '/auth/v1/signup') {
      assert.equal(body.email, mock.signupSession ? users[0].email : 'new@example.com');
      assert.equal(body.password, password);
      assert.equal(url.searchParams.get('redirect_to'), new URL(process.env.APP_URL || 'http://127.0.0.1:5173').origin);
      mock.signups++;
      await json(route, mock.signupSession ? session(users[0]) : { ...users[0], id: '33333333-3333-4333-8333-333333333333', email: body.email, identities: [] });
      return;
    }
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const user = users.find(user => body.refresh_token === `refresh-${user.id}`);
        assert.ok(user, 'Refresh token must belong to known user');
        mock.refreshes++;
        if (mock.refreshGate) await mock.refreshGate;
        await json(route, session(user));
      } else {
        assert.equal(url.searchParams.get('grant_type'), 'password');
        mock.passwordRequests.push(body);
        const user = users.find(user => user.email === body.email && body.password === password);
        await json(route, user ? session(user) : { code: 'invalid_credentials', msg: 'Invalid login credentials' }, user ? 200 : 400);
      }
      return;
    }
    const user = users.find(user => request.headers().authorization === `Bearer ${token(user)}`);
    assert.ok(user, 'Authenticated routes must carry current user token');
    if (url.pathname === '/auth/v1/user') {
      await json(route, user);
    } else if (url.pathname === '/auth/v1/logout') {
      assert.equal(url.searchParams.get('scope'), 'local');
      mock.logouts++;
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    } else if (url.pathname === '/rest/v1/companion_data') {
      assert.equal(request.method(), 'GET');
      assert.equal(url.searchParams.get('select').replaceAll(' ', ''), 'data,version');
      assert.equal(url.searchParams.get('user_id'), `eq.${user.id}`);
      mock.loads.push(user.id);
      const { data, version } = rows.get(user.id);
      await json(route, [{ data, version }]);
    } else if (url.pathname === '/rest/v1/rpc/save_companion_data') {
      assert.equal(request.method(), 'POST');
      assert.equal(body.expected_user, user.id);
      mock.writes.push(structuredClone(body));
      mock.inFlight++;
      mock.maxInFlight = Math.max(mock.maxInFlight, mock.inFlight);
      try {
        const nextSave = mock.nextSave;
        mock.nextSave = null;
        if (nextSave && await nextSave(route, body, user)) return;
        const version = save(body, user);
        await json(route, version ?? { code: '40001', message: conflict }, version === null ? 409 : 200);
      } finally { mock.inFlight--; }
    } else {
      throw new Error(`Unexpected Supabase route: ${request.method()} ${url.pathname}`);
    }
  } catch (error) {
    errors.push(`Mock: ${error.message}`);
    await json(route, { message: error.message }, 500);
  }
});
const contrast = async (scope = page) => {
  const failures = await scope.locator('body').evaluate(body => {
    const rgb = color => color.match(/[\d.]+/g).map(Number);
    const luminance = color => rgb(color).slice(0, 3).map(value => {
      value /= 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const background = element => {
      for (let current = element; current; current = current.parentElement) {
        const color = getComputedStyle(current).backgroundColor;
        if (rgb(color)[3] !== 0) return color;
      }
      return 'rgb(255, 255, 255)';
    };
    const failures = [];
    for (const element of body.querySelectorAll('*')) {
      if (!element.checkVisibility() || element.getBoundingClientRect().width < 2 || element.closest(':disabled') || element.matches('.sr-only, option')) continue;
      const style = getComputedStyle(element);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      if ([...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) || element.matches('input, textarea, select')) {
        const actual = ratio(style.color, background(element));
        if (actual < (large ? 3 : 4.5)) failures.push(`${element.className || element.tagName}: ${actual.toFixed(2)} ${style.color} on ${background(element)}`);
      }
      if (element.matches('input[placeholder], textarea[placeholder]')) {
        const actual = ratio(getComputedStyle(element, '::placeholder').color, background(element));
        if (actual < 4.5) failures.push(`placeholder: ${actual.toFixed(2)}`);
      }
      if (element.matches(':focus-visible')) {
        if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) < 2 || ratio(style.outlineColor, background(element)) < 3) failures.push(`focus: ${element.tagName}`);
      }
    }
    return failures;
  });
  assert.deepEqual(failures, [], 'Rendered text, placeholder and keyboard focus contrast meets WCAG AA');
};
const screenshot = async name => {
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true });
};
const status = text => page.getByRole('status').filter({ hasText: new RegExp(`^${text}$`) });
const saved = () => status('Saved to Supabase').waitFor();
const loginScreen = () => page.getByRole('heading', { name: 'Log in', exact: true }).waitFor();
const login = async user => {
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: '[Log in]', exact: true }).click();
  await saved();
};
const logout = async () => {
  await page.getByRole('button', { name: '[Log out]', exact: true }).click();
  await loginScreen();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
};
const noteDate = page.getByLabel('Note date', { exact: true });
const note = page.getByLabel('Daily note', { exact: true });
const dialog = page.getByRole('dialog', { name: 'Add item', exact: true });
const panel = page.getByRole('complementary', { name: 'Day details', exact: true });
const exportChanges = async (scope = page) => {
  const downloadEvent = page.waitForEvent('download');
  await scope.getByRole('button', { name: '[Export changes]', exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'text-companion-backup.json');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
};
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  if (process.env.CONFIG_ONLY) {
    await page.getByRole('alert').filter({ hasText: 'Supabase' }).waitFor();
    const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
    for (const value of ['light', 'dark']) {
      await theme.selectOption(value);
      assert.equal(await theme.isEnabled(), true);
      assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), value);
      await contrast();
      await screenshot(`configuration-${value}`);
    }
    assert.deepEqual(errors, []);
    console.log('Theme: unconfigured shell selector and contrast passed in both themes.');
  } else {
  await loginScreen();
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  const appearance = async expected => {
    await page.waitForFunction(expected => getComputedStyle(document.documentElement).colorScheme === expected, expected);
    const background = await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(background, expected === 'dark' ? 'rgb(38, 37, 34)' : 'rgb(252, 251, 249)');
  };
  assert.equal(await theme.count(), 1, 'Theme selector available before login');
  assert.deepEqual(await theme.locator('option').allTextContents(), ['System', 'Light', 'Dark']);
  assert.equal(await theme.inputValue(), 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await appearance('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await appearance('dark');
  await theme.selectOption('light');
  await appearance('light');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme.selectOption('dark');
  await appearance('dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await appearance('dark');
  await page.reload();
  await loginScreen();
  assert.equal(await theme.inputValue(), 'dark');
  await appearance('dark');
  await theme.selectOption('system');
  await appearance('light');
  console.log('Theme: selector, System live changes, explicit overrides and reload persistence passed.');

  const themeKey = 'text-companion-theme';
  const tab = await page.context().newPage();
  await tab.emulateMedia({ colorScheme: 'dark' });
  await tab.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  await tab.getByRole('combobox', { name: 'Theme', exact: true }).waitFor();
  await theme.selectOption('light');
  await tab.waitForFunction(() => document.querySelector('#theme').value === 'light');
  assert.equal(await tab.locator('html').evaluate(el => getComputedStyle(el).colorScheme), 'light');
  await tab.evaluate(key => localStorage.removeItem(key), themeKey);
  await page.waitForFunction(() => document.querySelector('#theme').value === 'system');
  await appearance('light');
  await theme.selectOption('dark');
  await tab.evaluate(key => localStorage.setItem(key, 'invalid-theme'), themeKey);
  await page.waitForFunction(() => document.querySelector('#theme').value === 'system');
  await appearance('light');
  await page.reload();
  await loginScreen();
  assert.equal(await theme.inputValue(), 'system');
  await appearance('light');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), themeKey), 'invalid-theme', 'Invalid stored preference stays untouched');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme.selectOption('dark');
  await appearance('dark');
  await tab.waitForFunction(() => document.querySelector('#theme').value === 'dark');
  await tab.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => document.querySelector('#theme').value === 'system');
  await appearance('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await appearance('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await appearance('light');
  await tab.close();
  console.log('Theme: same-origin tabs, removal, clearing and invalid preference fallback passed.');

  // Hold app JS, not the startup script; inspect every styled animation frame before React.
  for (const [preference, system, expected] of [[null, 'light', 'light'], [null, 'dark', 'dark'], ['dark', 'light', 'dark'], ['light', 'dark', 'light']]) {
    const startup = await context.newPage();
    await startup.emulateMedia({ colorScheme: system });
    await startup.addInitScript(({ key, preference }) => {
      if (preference === null) localStorage.removeItem(key); else localStorage.setItem(key, preference);
      window.styledFrames = [];
      const sample = () => {
        const style = getComputedStyle(document.documentElement);
        if (style.fontFamily.startsWith('Georgia')) window.styledFrames.push([style.backgroundColor, style.colorScheme]);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { key: themeKey, preference });
    const held = Promise.withResolvers();
    const release = Promise.withResolvers();
    await startup.route('**/*', async route => {
      if (/\/src\/main\.tsx$|\/assets\/.*\.js$/.test(new URL(route.request().url()).pathname)) {
        held.resolve();
        await release.promise;
      }
      await route.continue();
    });
    try {
      await startup.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'commit' });
      await held.promise;
      await startup.waitForFunction(() => window.styledFrames.length >= 3, null, { timeout: 3000 });
      assert.equal(await startup.locator('#root').textContent(), '', 'App JS still held');
      const frames = await startup.evaluate(() => window.styledFrames);
      assert.ok(frames.every(([background, scheme]) => background === (expected === 'dark' ? 'rgb(38, 37, 34)' : 'rgb(252, 251, 249)') && scheme === expected), `${preference}/${system}: no wrong-theme styled frame`);
    } finally {
      release.resolve();
      await startup.close();
    }
  }
  await page.evaluate(key => localStorage.removeItem(key), themeKey);
  await page.reload();
  await loginScreen();
  console.log('Theme: pre-React first styled frames respect System and saved opposite-system overrides.');

  for (const operation of ['getItem', 'setItem']) {
    const blocked = await context.newPage();
    blocked.on('pageerror', error => errors.push(error.message));
    await blocked.addInitScript(({ key, operation }) => {
      localStorage.removeItem(key);
      localStorage.setItem('text-companion-daily-tasks', 'preserve corrupt domain data');
      const original = Storage.prototype[operation];
      Storage.prototype[operation] = function (name, ...args) {
        if (name === key) throw new DOMException('Storage blocked', 'SecurityError');
        return original.call(this, name, ...args);
      };
    }, { key: themeKey, operation });
    await blocked.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
    const control = blocked.getByRole('combobox', { name: 'Theme', exact: true });
    await control.selectOption('dark');
    assert.equal(await control.inputValue(), 'dark', 'Storage failure retains in-session selection');
    assert.equal(await blocked.locator('html').evaluate(el => getComputedStyle(el).colorScheme), 'dark');
    if (operation === 'setItem') await blocked.getByRole('status').filter({ hasText: 'Theme applies to this tab; browser could not remember it.' }).waitFor();
    await blocked.getByLabel('Email', { exact: true }).fill('editable@example.com');
    assert.equal(await blocked.getByLabel('Email', { exact: true }).inputValue(), 'editable@example.com');
    assert.equal(await blocked.evaluate(() => localStorage.getItem('text-companion-daily-tasks')), 'preserve corrupt domain data');
    await blocked.close();
  }
  await page.evaluate(() => localStorage.removeItem('text-companion-daily-tasks'));
  await page.reload();
  await loginScreen();
  console.log('Theme: denied reads and failed writes keep UI usable, report failure and preserve unrelated data.');
  await page.getByLabel('Email', { exact: true }).fill(users[0].email);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '[Log in]', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Invalid login credentials' }).waitFor();
  for (const value of ['light', 'dark']) {
    await theme.selectOption(value);
    await theme.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await theme.evaluate(el => el === document.activeElement && el.matches(':focus-visible')), true);
    const hiddenFocus = await page.addStyleTag({ content: '#theme:focus-visible { outline: none !important; }' });
    try {
      await assert.rejects(() => contrast(), error => error.code === 'ERR_ASSERTION' && error.actual.includes('focus: SELECT'), 'Missing keyboard focus outline must fail contrast check');
    } finally {
      await hiddenFocus.evaluate(el => el.remove());
    }
    await contrast();
    await screenshot(`auth-${value}`);
  }
  assert.equal(await page.locator('.sidebar').count(), 0);
  assert.equal(mock.loads.length, 0);
  await page.getByRole('button', { name: '[Create account]', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('new@example.com');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: '[Create account]', exact: true }).click();
  await status('Check your email to confirm your account, then log in.').waitFor();
  assert.equal(mock.signups, 1);
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('.sidebar').count(), 0);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
  assert.equal(mock.loads.length, 0, 'Confirmation-required signup must not open a workspace');
  mock.signupSession = true;
  await page.getByLabel('Email', { exact: true }).fill(users[0].email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: '[Create account]', exact: true }).click();
  await saved();
  assert.equal(mock.signups, 2);
  assert.equal(mock.passwordRequests.length, 1, 'Immediate signup must open workspace without password login');
  assert.equal(await page.getByRole('status').filter({ hasText: 'Check your email' }).count(), 0);
  await page.reload();
  await saved();
  assert.equal(mock.passwordRequests.length, 1, 'Signup session must persist across reload');
  await logout();
  await login(users[0]);
  await page.getByRole('checkbox', { name: 'Alice cloud task', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Alice private habit', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Bob private habit', exact: true }).count(), 0);
  await noteDate.fill('2024-02-29');
  assert.equal(await note.inputValue(), 'Alice private note');
  const dataBeforeTheme = structuredClone([...rows]);
  const writesBeforeTheme = mock.writes.length;
  assert.equal(await theme.inputValue(), 'dark', 'Login retains browser choice');
  const habitBeforeTheme = await page.getByRole('checkbox', { name: 'Alice private habit', exact: true }).isChecked();
  const cursorBeforeTheme = await page.locator('#calendar-heading').textContent();
  for (const value of ['light', 'dark']) {
    await theme.selectOption(value);
    await appearance(value);
    await theme.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await contrast();
    await screenshot(`workspace-${value}`);
    assert.equal(await note.inputValue(), 'Alice private note');
    assert.equal(await noteDate.inputValue(), '2024-02-29');
    assert.equal(await page.locator('#calendar-heading').textContent(), cursorBeforeTheme);
    assert.equal(await page.getByRole('checkbox', { name: 'Alice private habit', exact: true }).isChecked(), habitBeforeTheme);
    await page.locator('button[aria-current="date"]').click();
    const surface = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(surface, value === 'dark' ? 'rgb(38, 37, 34)' : 'rgb(252, 251, 249)', 'Day details inherits theme');
    await contrast();
    await screenshot(`details-${value}`);
    await panel.getByRole('button', { name: '[Close]', exact: true }).click();
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await contrast();
    await screenshot(`week-${value}`);
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), surface, 'Add item inherits theme');
    assert.equal(await dialog.getByLabel('Type', { exact: true }).evaluate(el => getComputedStyle(el).colorScheme), value);
    assert.equal(await dialog.getByLabel('Date', { exact: true }).evaluate(el => getComputedStyle(el).colorScheme), value);
    await contrast();
    await screenshot(`add-${value}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '[All notes]', exact: true }).click();
    const allNotes = page.getByRole('dialog', { name: 'All notes', exact: true });
    assert.equal(await allNotes.evaluate(el => getComputedStyle(el).backgroundColor), surface, 'All notes inherits theme');
    await allNotes.getByRole('button', { name: /2024-02-29 Alice private note/ }).hover();
    await contrast();
    await screenshot(`notes-${value}`);
    await page.keyboard.press('Escape');
  }
  assert.equal(mock.writes.length, writesBeforeTheme, 'Theme changes never trigger domain saves');
  assert.deepEqual([...rows], dataBeforeTheme, 'Cloud snapshots unchanged by theme');
  const passwordRequests = mock.passwordRequests.length;
  await page.reload();
  await saved();
  assert.equal(mock.passwordRequests.length, passwordRequests, 'Reload must restore session without password login');
  await noteDate.fill('2024-02-29');
  assert.equal(await note.inputValue(), 'Alice private note');
  await page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key));
    session.expires_at = 1;
    localStorage.setItem(key, JSON.stringify(session));
  }, sessionKey);
  const restore = Promise.withResolvers();
  mock.refreshGate = restore.promise;
  await page.reload();
  await status('Restoring your session…').waitFor();
  assert.equal(await theme.isEnabled(), true);
  await theme.selectOption('light');
  await appearance('light');
  await theme.selectOption('dark');
  await contrast();
  restore.resolve();
  mock.refreshGate = null;
  await saved();
  assert.equal(mock.refreshes, 1, 'Expired persisted session must use refresh-token route');
  assert.equal(mock.passwordRequests.length, passwordRequests);
  await logout();
  const loadsBeforeLogoutReload = mock.loads.length;
  await page.reload();
  await loginScreen();
  assert.equal(mock.loads.length, loadsBeforeLogoutReload);
  await login(users[1]);
  assert.equal(await theme.inputValue(), 'dark', 'Logout and account switch retain browser choice');
  await page.getByRole('checkbox', { name: 'Bob cloud task', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Alice cloud task', exact: true }).count(), 0);
  await page.getByRole('checkbox', { name: 'Bob private habit', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Alice private habit', exact: true }).count(), 0);
  await noteDate.fill('2024-02-29');
  assert.equal(await note.inputValue(), 'Bob private note');
  await logout();
  await login(users[0]);
  assert.equal(await page.getByRole('checkbox', { name: 'Bob cloud task', exact: true }).count(), 0);
  assert.equal(await page.getByRole('checkbox', { name: 'Bob private habit', exact: true }).count(), 0);
  assert.ok(mock.loads.includes(users[0].id) && mock.loads.includes(users[1].id));

  assert.equal(await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width), 320);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.ok(await note.evaluate(el => el.getBoundingClientRect().height) >= 160);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await dialog.getByLabel('Title').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  }
  await dialog.getByLabel('Title').fill('Browser task');
  await dialog.getByLabel('Date', { exact: true }).fill('2024-02-29');
  await dialog.getByRole('button', { name: '[Add]', exact: true }).click();
  await saved();
  await page.getByRole('button', { name: 'Add item', exact: true }).focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Add item', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await dialog.getByLabel('Title').fill('Browser habit');
  await dialog.getByLabel('Type', { exact: true }).selectOption('habit');
  assert.equal(await dialog.getByLabel('Date', { exact: true }).count(), 0);
  await dialog.getByRole('button', { name: '[Add]', exact: true }).click();
  await saved();
  const habit = page.getByRole('checkbox', { name: 'Browser habit', exact: true });
  const todayCell = page.locator('button[aria-current="date"]');
  await habit.check();
  await saved();
  assert.match(await todayCell.getAttribute('aria-label'), /1 habits completed/);
  await habit.uncheck();
  await saved();
  assert.match(await todayCell.getAttribute('aria-label'), /0 habits completed/);
  await habit.check();
  await saved();
  await todayCell.focus();
  await page.keyboard.press('Enter');
  await panel.waitFor();
  assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await todayCell.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: 'Edit Browser habit', exact: true }).click();
  await panel.getByLabel('Title', { exact: true }).fill('Renamed habit');
  await panel.getByRole('button', { name: '[Save]', exact: true }).click();
  await saved();
  assert.equal(await page.getByRole('checkbox', { name: 'Renamed habit', exact: true }).isChecked(), true);
  await panel.getByRole('button', { name: 'Delete Renamed habit', exact: true }).click();
  await saved();
  assert.equal(await page.getByRole('checkbox', { name: 'Renamed habit', exact: true }).count(), 0);
  await note.fill('Today note');
  await panel.getByText('Today note', { exact: true }).waitFor();
  await saved();
  await noteDate.fill('2024-02-29');
  await note.fill('Leap day note');
  await saved();
  await page.getByRole('button', { name: '[All notes]', exact: true }).click();
  const notes = page.getByRole('dialog', { name: 'All notes', exact: true });
  await notes.getByRole('button', { name: /2024-02-29 Leap day note/ }).click();
  assert.equal(await note.inputValue(), 'Leap day note');
  await panel.getByRole('button', { name: '[Close]', exact: true }).click();
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.day-cell').length === 7);
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.reload();
  await saved();
  assert.equal(await page.getByRole('checkbox', { name: 'Renamed habit', exact: true }).count(), 0);
  await noteDate.fill('2024-02-29');
  assert.equal(await note.inputValue(), 'Leap day note');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await todayCell.click();
  await panel.getByRole('button', { name: 'Add item for selected day', exact: true }).click();
  await dialog.getByLabel('Title').fill('Detail task');
  await dialog.getByRole('button', { name: '[Add]', exact: true }).click();
  await saved();
  await panel.getByRole('button', { name: 'Edit Detail task', exact: true }).click();
  await panel.getByLabel('Title', { exact: true }).fill('Changed task');
  await panel.getByRole('button', { name: '[Save]', exact: true }).click();
  await saved();
  await panel.getByRole('button', { name: 'Delete Changed task', exact: true }).click();
  await saved();
  assert.equal(await page.getByRole('checkbox', { name: 'Changed task', exact: true }).count(), 0);
  await panel.getByRole('button', { name: '[Close]', exact: true }).click();
  await page.getByRole('button', { name: '[All notes]', exact: true }).click();
  await page.mouse.click(5, 5);
  await notes.waitFor({ state: 'hidden' });

  const alice = rows.get(users[0].id);
  const rapidStart = mock.writes.length;
  const rapidVersion = alice.version;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  mock.nextSave = async (_route, body) => { entered.resolve(body); await release.promise; return false; };
  await note.fill('Rapid note 1');
  await entered.promise;
  await status('Saving…').waitFor();
  const themeWrites = mock.writes.length;
  await theme.selectOption('light');
  await contrast();
  await theme.selectOption('dark');
  assert.equal(await note.inputValue(), 'Rapid note 1', 'Changing theme preserves pending DailyNote');
  assert.equal(mock.writes.length, themeWrites, 'Changing theme never enqueues domain saves');
  await note.fill('Rapid note 2');
  await note.fill('Rapid note 3');
  assert.equal(mock.writes.length, rapidStart + 1, 'Only first write may run while its acknowledgement is held');
  assert.equal(await status('Saved to Supabase').count(), 0);
  release.resolve();
  await saved();
  const rapidWrites = mock.writes.slice(rapidStart);
  assert.equal(rapidWrites.length, 2, 'Pending snapshots must coalesce to latest note');
  assert.deepEqual(rapidWrites.map(write => write.expected_version), [rapidVersion, rapidVersion + 1]);
  assert.notEqual(rapidWrites[0].request_id, rapidWrites[1].request_id);
  assert.equal(alice.data.notes['2024-02-29'], 'Rapid note 3');
  assert.equal(mock.maxInFlight, 1);

  const failedStart = mock.writes.length;
  mock.nextSave = async route => { await json(route, { code: 'XX000', message: 'Cloud unavailable' }, 500); return true; };
  await note.fill('Unsaved note must survive');
  await page.getByRole('alert').filter({ hasText: 'Cloud unavailable' }).waitFor();
  await status('Not saved').waitFor();
  for (const value of ['light', 'dark']) { await theme.selectOption(value); await contrast(); }
  const remainingTask = page.getByRole('checkbox', { name: 'Browser task', exact: true });
  await remainingTask.check();
  assert.equal(await remainingTask.isChecked(), true, 'Failed RPC must retain optimistic changes');
  const oldDate = await noteDate.inputValue();
  await page.getByRole('button', { name: 'Next note day', exact: true }).click();
  assert.equal(await noteDate.inputValue(), oldDate);
  assert.equal(await note.inputValue(), 'Unsaved note must survive');
  await page.getByRole('button', { name: '[All notes]', exact: true }).click();
  assert.equal(await notes.count(), 0);
  const logoutsBeforeGuard = mock.logouts;
  await page.getByRole('button', { name: '[Log out]', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Unsaved changes' }).waitFor();
  assert.equal(mock.logouts, logoutsBeforeGuard);
  await page.getByRole('button', { name: '[Retry save]', exact: true }).click();
  await saved();
  assert.deepEqual(mock.writes[failedStart + 1], mock.writes[failedStart], 'Retry must reuse failed snapshot and request ID');
  assert.equal(alice.data.notes[oldDate], 'Unsaved note must survive');
  assert.equal(alice.data.todos.find(todo => todo.title === 'Browser task').isCompleted, true);
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.reload();
  await saved();
  await noteDate.fill(oldDate);
  assert.equal(await note.inputValue(), 'Unsaved note must survive');
  assert.equal(await remainingTask.isChecked(), true);

  const lostStart = mock.writes.length;
  const lostVersion = alice.version;
  mock.nextSave = async (route, body, user) => { assert.equal(save(body, user), lostVersion + 1); await route.abort('failed'); return true; };
  await note.fill('Committed but acknowledgement lost');
  await page.getByRole('alert').filter({ hasText: 'Changes not saved' }).waitFor();
  assert.equal(alice.version, lostVersion + 1);
  assert.equal(alice.data.notes[oldDate], 'Committed but acknowledgement lost');
  await page.getByRole('button', { name: '[Retry save]', exact: true }).click();
  await saved();
  assert.deepEqual(mock.writes[lostStart + 1], mock.writes[lostStart]);
  assert.equal(alice.version, lostVersion + 1, 'Lost-ack retry must not increment version twice');

  alice.version++;
  alice.lastWriteId = 'other-device';
  alice.data.notes[oldDate] = 'Other device note';
  const serverSnapshot = structuredClone(alice);
  const conflictStart = mock.writes.length;
  await note.fill('Local conflicting note');
  await page.getByRole('alert').filter({ hasText: conflict }).waitFor();
  assert.equal(await note.inputValue(), 'Local conflicting note');
  assert.deepEqual(alice, serverSnapshot, 'Conflict must not overwrite newer server snapshot');
  await page.getByRole('button', { name: 'Next note day', exact: true }).click();
  assert.equal(await noteDate.inputValue(), oldDate);
  await page.getByRole('button', { name: '[Log out]', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Unsaved changes' }).waitFor();
  assert.equal(mock.logouts, logoutsBeforeGuard);
  const backup = await exportChanges();
  assert.equal(backup.notes[oldDate], 'Local conflicting note');
  assert.equal(backup.todos.find(todo => todo.title === 'Browser task').isCompleted, true);
  await page.getByRole('button', { name: '[Retry save]', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: conflict }).waitFor();
  assert.deepEqual(mock.writes[conflictStart + 1], mock.writes[conflictStart]);
  assert.deepEqual(alice, serverSnapshot);
  const acceptUnload = dialog => dialog.accept();
  page.on('dialog', acceptUnload);
  await page.reload();
  page.off('dialog', acceptUnload);
  await saved();
  await noteDate.fill(oldDate);
  assert.equal(await note.inputValue(), 'Other device note');

  await page.clock.install({ time: new Date('2024-02-29T23:59:00-08:00') });
  await page.reload();
  await saved();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await dialog.getByLabel('Title').fill('Midnight habit');
  await dialog.getByLabel('Type', { exact: true }).selectOption('habit');
  await dialog.getByRole('button', { name: '[Add]', exact: true }).click();
  await saved();
  const midnightHabit = page.getByRole('checkbox', { name: 'Midnight habit', exact: true });
  await midnightHabit.check();
  await saved();
  await page.clock.runFor(61_000);
  await saved();
  assert.equal(await midnightHabit.isChecked(), false);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  assert.match(await todayCell.getAttribute('aria-label'), /March 1, 2024/);
  await page.getByRole('button', { name: /Thursday, February 29, 2024/ }).click();
  await panel.getByText('Midnight habit', { exact: true }).waitFor();
  await logout();
  assert.equal(mock.logouts, 4);

  await login(users[0]);
  const externalDate = await noteDate.inputValue();
  mock.nextSave = async route => { await json(route, { message: 'Cloud unavailable' }, 500); return true; };
  await note.fill('Draft kept after external logout');
  await status('Not saved').waitFor();
  const writesBeforeExternalLogout = mock.writes.length;
  await page.evaluate(key => {
    localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: 'SIGNED_OUT', session: null });
    channel.close();
  }, sessionKey);
  const sessionAlert = page.getByRole('alert').filter({ hasText: 'Session changed. Your changes remain in this tab.' });
  await sessionAlert.waitFor();
  assert.equal(await note.inputValue(), 'Draft kept after external logout');
  assert.equal(await note.isDisabled(), true);
  for (const value of ['light', 'dark']) {
    assert.equal(await theme.isEnabled(), true, 'Theme stays outside disabled workspace');
    await theme.selectOption(value);
    await appearance(value);
    await contrast();
    assert.equal(await note.inputValue(), 'Draft kept after external logout');
  }
  assert.equal(await page.getByRole('button', { name: '[Retry save]', exact: true }).isDisabled(), true);
  const externalBackup = await exportChanges(sessionAlert);
  assert.equal(externalBackup.notes[externalDate], 'Draft kept after external logout');
  assert.equal(rows.get(users[0].id).data.notes[externalDate] === 'Draft kept after external logout', false);
  assert.equal(mock.writes.length, writesBeforeExternalLogout);
  const dismissedConfirmation = page.waitForEvent('dialog');
  const continueClick = sessionAlert.getByRole('button', { name: '[Continue to log in]', exact: true }).click();
  const confirmation = await dismissedConfirmation;
  assert.equal(confirmation.type(), 'confirm');
  assert.match(confirmation.message(), /Discard unsaved changes/);
  await confirmation.dismiss();
  await continueClick;
  assert.equal(await sessionAlert.isVisible(), true);
  assert.equal(await note.inputValue(), 'Draft kept after external logout');
  const acceptedConfirmation = page.waitForEvent('dialog');
  const acceptedClick = sessionAlert.getByRole('button', { name: '[Continue to log in]', exact: true }).click();
  await (await acceptedConfirmation).accept();
  await acceptedClick;
  await loginScreen();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
  assert.equal(mock.maxInFlight, 1);
  assert.deepEqual(errors, []);
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.log('Browser: mocked auth/session refresh/logout, per-user cloud data, calendar/modal/habits/midnight, serialized autosave, RPC retry/lost-ack idempotence, conflict/export and external logout guards passed.');
  }
} finally {
  await browser.close();
}
