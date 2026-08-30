import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SIDEBAR_BREAKPOINT,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  sidebarNavigationWidth,
  usesSidebarNavigation,
} from '../src/domain/mainNavigation';

test('wide iPad layouts use the sidebar while compact layouts keep bottom tabs', () => {
  assert.equal(SIDEBAR_BREAKPOINT, 768);
  assert.equal(usesSidebarNavigation(767), false);
  assert.equal(usesSidebarNavigation(768), true);
  assert.equal(usesSidebarNavigation(1366), true);
  assert.equal(usesSidebarNavigation(Number.NaN), false);
});

test('sidebar collapse uses fixed rail widths that return space to the screen', () => {
  assert.equal(SIDEBAR_EXPANDED_WIDTH, 248);
  assert.equal(SIDEBAR_COLLAPSED_WIDTH, 76);
  assert.equal(sidebarNavigationWidth(true), 248);
  assert.equal(sidebarNavigationWidth(false), 76);
  assert.equal(sidebarNavigationWidth(true) - sidebarNavigationWidth(false), 172);
});

test('main navigation exposes an accessible collapsible sidebar and route-safe tabs', () => {
  const navigator = readFileSync(
    new URL('../src/navigation/RootNavigator.tsx', import.meta.url),
    'utf8',
  );
  const tabBar = readFileSync(
    new URL('../src/components/navigation/CollapsibleTabBar.tsx', import.meta.url),
    'utf8',
  );

  assert.match(navigator, /tabBarPosition: isSidebar \? 'left' : 'bottom'/);
  assert.match(navigator, /<CollapsibleTabBar/);
  for (const route of ['Dashboard', 'Inventory', 'Settings']) {
    assert.match(navigator, new RegExp(`name="${route}"`));
  }
  assert.match(tabBar, /Collapse navigation sidebar/);
  assert.match(tabBar, /Expand navigation sidebar/);
  assert.match(tabBar, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(tabBar, /type: 'tabPress'/);
  assert.match(tabBar, /sidebar: \{\s*alignSelf: 'stretch'/);
  assert.match(tabBar, /flexShrink: 0/);
  assert.doesNotMatch(tabBar, /sidebar: \{[^}]*flex: 1/s);
  assert.doesNotMatch(navigator, /⌂|▦|⚙/);
});

test('login is automatic and does not expose product-source choices', () => {
  const login = readFileSync(
    new URL('../src/screens/LoginScreen.tsx', import.meta.url),
    'utf8',
  );

  assert.match(login, /await login\(username, password\)/);
  assert.doesNotMatch(login, /Account source|Eco Audit|Solar Sense|sourceApp|radiogroup/);
});

test('remote materialization normalizes location metadata before storing it', () => {
  const repository = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  const materialize = repository.slice(
    repository.indexOf('export async function importRemoteInstallationAsCopy'),
    repository.indexOf('export async function syncAssignedInstallations'),
  );

  assert.match(materialize, /normalizeAustralianAddress\(\{/);
  assert.match(materialize, /\.\.\.installationAddressFields\(importedAddress\)/);
  assert.doesNotMatch(materialize, /site_country_code: optionalText\(source/);
  assert.doesNotMatch(materialize, /site_latitude: nullableCoordinate\(source/);
});
