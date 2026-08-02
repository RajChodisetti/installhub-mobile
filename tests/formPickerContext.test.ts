import assert from 'node:assert/strict';
import test from 'node:test';
import { FORM_DEFINITIONS } from '../src/forms/catalog';
import { isFormTypeAvailableForContext } from '../src/domain/formPickerContext';

function availableTypes(context: Parameters<typeof isFormTypeAvailableForContext>[1]) {
  return FORM_DEFINITIONS
    .filter((definition) => definition.availableForNew !== false)
    .filter((definition) => isFormTypeAvailableForContext(definition.type, context))
    .map((definition) => definition.type);
}

test('board and meter context offers installation and communications forms', () => {
  assert.deepEqual(
    availableTypes({ boardId: 'board-1', meterId: 'meter-1' }),
    ['ww-installation', 'comms-fault'],
  );
});

test('meter-only context remains limited to the communications-fault form', () => {
  assert.deepEqual(
    availableTypes({ meterId: 'meter-1' }),
    ['comms-fault'],
  );
});

test('board-only and site-asset picker contexts retain their existing catalogs', () => {
  assert.deepEqual(
    availableTypes({ boardId: 'board-1' }),
    ['ww-installation', 'ace-switchboard'],
  );
  assert.deepEqual(
    availableTypes({ siteAssetId: 'asset-1' }),
    ['honeywell-q400', 'captis-logger', 'sums-logger'],
  );
});
