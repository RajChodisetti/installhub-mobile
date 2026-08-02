import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOrphanedSourceUser,
  isSourceManagedUser,
  passwordChangeSessionNotice,
  sourceAppDisplayName,
  sourceManagedBadgeLabel,
  sourceUserDisplayEmail,
} from '../src/utils/sourceManagedUsers';

test('identifies only explicitly source-managed users as read only', () => {
  assert.equal(isSourceManagedUser(undefined), false);
  assert.equal(isSourceManagedUser({}), false);
  assert.equal(
    isSourceManagedUser({ sourceManaged: false, sourceApp: 'ecoaudit' }),
    false,
  );
  assert.equal(
    isSourceManagedUser({ sourceManaged: true, sourceApp: 'ecoaudit' }),
    true,
  );
  assert.equal(isSourceManagedUser({ sourceState: 'orphaned' }), true);
  assert.equal(isOrphanedSourceUser({ sourceState: 'linked' }), false);
  assert.equal(isOrphanedSourceUser({ sourceState: 'orphaned' }), true);
});

test('formats source provenance for both supported legacy apps', () => {
  assert.equal(sourceAppDisplayName('ecoaudit'), 'Eco Audit');
  assert.equal(sourceAppDisplayName('solarsense'), 'Solar Sense');
  assert.equal(sourceAppDisplayName(null), 'source app');
  assert.equal(
    sourceManagedBadgeLabel({
      sourceManaged: true,
      sourceApp: 'solarsense',
    }),
    'Solar Sense · read only',
  );
  assert.equal(
    sourceManagedBadgeLabel({
      sourceManaged: false,
      sourceApp: 'solarsense',
    }),
    null,
  );
  assert.equal(
    sourceManagedBadgeLabel({
      sourceManaged: true,
      sourceApp: 'solarsense',
      sourceState: 'orphaned',
    }),
    'Source unavailable · read only',
  );
});

test('never presents blank or internal bridge email as a user identity', () => {
  assert.equal(sourceUserDisplayEmail(''), 'Source account unavailable');
  assert.equal(sourceUserDisplayEmail('   '), 'Source account unavailable');
  assert.equal(
    sourceUserDisplayEmail(
      'bridge-a4ff91c19b3d@installhub.users.local',
    ),
    'Source account unavailable',
  );
  assert.equal(
    sourceUserDisplayEmail('installer@installhub.users.local'),
    'installer@installhub.users.local',
  );
  assert.equal(
    sourceUserDisplayEmail('person@example.com'),
    'person@example.com',
  );
});

test('password change notice states local, refresh, and access-token timing exactly', () => {
  assert.equal(
    passwordChangeSessionNotice('ecoaudit', true),
    "This device's local session is cleared immediately. Refresh sessions for Eco Audit and Field App Complete are revoked. Already-issued access tokens may remain valid for up to 15 minutes.",
  );
  assert.equal(
    passwordChangeSessionNotice(null, false),
    "This device's local Field App Complete session is cleared immediately. Field App Complete refresh sessions are revoked. Already-issued access tokens may remain valid for up to 15 minutes.",
  );
});
