import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  schedulerRouteAddCalendarDays,
  schedulerRouteCalendarDateIsValid,
  schedulerRouteCoordinatesFromAddress,
  schedulerRouteDistance,
  schedulerRouteDuration,
  schedulerRouteJobCanOpenInFieldApp,
  schedulerRouteJobTypeLabel,
  schedulerRouteLocalCalendarDate,
  schedulerRouteLocationIsAustralian,
  schedulerRouteScheduledTimeLabel,
  schedulerRouteStartingAddress,
  SCHEDULER_ROUTE_STARTING_ADDRESS_MAX_LENGTH,
  SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH,
} from '../src/domain/schedulerRoute';

test('route calendar helpers validate and step real dates without UTC rollover', () => {
  assert.equal(schedulerRouteCalendarDateIsValid('2028-02-29'), true);
  assert.equal(schedulerRouteCalendarDateIsValid('2027-02-29'), false);
  assert.equal(schedulerRouteCalendarDateIsValid('28/08/2026'), false);
  assert.equal(schedulerRouteAddCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(schedulerRouteAddCalendarDays('2026-03-01', -1), '2026-02-28');
  assert.equal(
    schedulerRouteLocalCalendarDate(new Date(2026, 7, 28, 23, 59)),
    '2026-08-28',
  );
});

test('route origin validation accepts Australia and rejects overseas or invalid coordinates', () => {
  assert.equal(schedulerRouteLocationIsAustralian({
    latitude: -33.8688,
    longitude: 151.2093,
  }), true);
  assert.equal(schedulerRouteLocationIsAustralian({
    latitude: 33.4484,
    longitude: -112.074,
  }), false);
  assert.equal(schedulerRouteLocationIsAustralian({
    latitude: Number.NaN,
    longitude: 151.2093,
  }), false);
});

test('an entered Australian address becomes an exact transient route origin', () => {
  assert.deepEqual(schedulerRouteCoordinatesFromAddress({
    latitude: -37.8183,
    longitude: 144.9671,
  }), {
    latitude: -37.8183,
    longitude: 144.9671,
  });
  assert.equal(schedulerRouteCoordinatesFromAddress({
    latitude: null,
    longitude: 144.9671,
  }), null);
  assert.equal(schedulerRouteCoordinatesFromAddress({
    latitude: 33.4484,
    longitude: -112.074,
  }), null);
  assert.equal(
    schedulerRouteStartingAddress('  Flinders Street Station, Melbourne VIC 3000  '),
    'Flinders Street Station, Melbourne VIC 3000',
  );
  assert.equal(schedulerRouteStartingAddress('   '), null);
  assert.equal(
    schedulerRouteStartingAddress('A'.repeat(SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH - 1)),
    null,
  );
  assert.equal(
    schedulerRouteStartingAddress('A'.repeat(SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH)),
    'A'.repeat(SCHEDULER_ROUTE_STARTING_ADDRESS_MIN_LENGTH),
  );
  assert.equal(
    schedulerRouteStartingAddress('A'.repeat(SCHEDULER_ROUTE_STARTING_ADDRESS_MAX_LENGTH + 1)),
    null,
  );
});

test('route formatters keep travel summaries compact', () => {
  assert.equal(schedulerRouteDistance(850), '850 m');
  assert.equal(schedulerRouteDistance(12_500), '13 km');
  assert.equal(schedulerRouteDuration(5_400), '1 hr 30 min');
  assert.equal(schedulerRouteDuration(5), '1 min');
});

test('route source types stay forward-compatible while only Field installations can open', () => {
  assert.equal(schedulerRouteJobTypeLabel('ecoaudit'), 'EcoAudit');
  assert.equal(schedulerRouteJobTypeLabel('solarsense'), 'SolarSense');
  assert.equal(schedulerRouteJobTypeLabel('installhub'), 'Field App');
  assert.equal(schedulerRouteJobTypeLabel('custom'), 'Custom');
  assert.equal(schedulerRouteJobCanOpenInFieldApp({
    sourceApp: 'installhub',
    sourceType: 'installation',
    sourceId: 'installation-1',
  }), true);
  assert.equal(schedulerRouteJobCanOpenInFieldApp({
    sourceApp: 'ecoaudit',
    sourceType: 'audit',
    sourceId: 'audit-1',
  }), false);
  assert.equal(schedulerRouteJobCanOpenInFieldApp({
    sourceApp: 'installhub',
    sourceType: 'custom',
    sourceId: 'installation-1',
  }), false);
});

test('scheduled-time labels use the route response timezone', () => {
  const label = schedulerRouteScheduledTimeLabel({
    scheduledStartAt: '2026-08-20T00:30:00.000Z',
    scheduledEndAt: '2026-08-20T01:45:00.000Z',
  }, 'Australia/Sydney');
  assert.match(label, /10:30/);
  assert.match(label, /11:45/);
  assert.match(label, /–/);
  assert.equal(schedulerRouteScheduledTimeLabel({
    scheduledStartAt: 'not-a-date',
    scheduledEndAt: null,
  }, 'Australia/Sydney'), 'not-a-date');
});

test('route location and job opening retain acquisition-time and session fences', () => {
  const screen = readFileSync(
    new URL('../src/screens/DailyRouteScreen.tsx', import.meta.url),
    'utf8',
  );
  const location = readFileSync(
    new URL('../src/services/routeLocation.ts', import.meta.url),
    'utf8',
  );
  const leaseCapture = screen.indexOf('captureAuthenticatedCloudActionLease()');
  const openingState = screen.indexOf('setOpeningEventId(job.eventId)');

  assert.notEqual(leaseCapture, -1);
  assert.notEqual(openingState, -1);
  assert.ok(leaseCapture < openingState);
  assert.match(screen, /runLeasedCloudActionStep/);
  assert.match(screen, /applyLeasedCloudActionState/);
  assert.match(screen, /title="Current location"/);
  assert.match(screen, /title="Australian address"/);
  assert.match(screen, /schedulerRouteCoordinatesFromAddress/);
  assert.match(screen, /startingAddress/);
  assert.match(screen, /Selecting a suggestion is optional/);
  assert.match(location, /requestForegroundPermissionsAsync/);
  assert.match(location, /getCurrentPositionAsync/);
  assert.doesNotMatch(location, /watchPositionAsync|startLocationUpdatesAsync/);
  assert.match(location, /new Date\(position\.timestamp\)/);
  assert.doesNotMatch(location, /capturedAt:\s*new Date\(\)/);
  assert.doesNotMatch(screen, /AsyncStorage|SecureStore|MapView|Linking\.openURL/);
});
