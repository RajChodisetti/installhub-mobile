import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  FORM_DEFINITION_BY_TYPE,
  FORM_DEFINITIONS,
  SENSOR_OPTIONS_BY_DEVICE,
  answersAfterChange,
  isFieldVisible,
  isSectionVisible,
  meterAfterCommsReplacement,
  optionsForField,
  validateForm,
} from '../src/forms/catalog';
import { buildFormReportHtml } from '../src/services/formReportHtml';
import { formPdfFilename } from '../src/services/reportFilenames';
import type { FormAttachment, FormSubmission } from '../src/types';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(
        (value as Record<string, unknown>)[key],
      )}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

test('the picker catalog contains the six supplied form families', () => {
  assert.deepEqual(
    FORM_DEFINITIONS
      .filter((definition) => definition.availableForNew !== false)
      .map((definition) => definition.type),
    [
      'ww-installation',
      'comms-fault',
      'ace-switchboard',
      'honeywell-q400',
      'captis-logger',
      'sums-logger',
    ],
  );
});

test('legacy A3RM and A6M form types remain readable', () => {
  assert.equal(FORM_DEFINITION_BY_TYPE['a3rm-installation'].availableForNew, false);
  assert.equal(FORM_DEFINITION_BY_TYPE['a6m-installation'].availableForNew, false);
});

test('the full mobile catalog matches the audited portal contract fingerprint', () => {
  const sectionCount = FORM_DEFINITIONS.reduce(
    (count, definition) => count + definition.sections.length,
    0,
  );
  const fieldCount = FORM_DEFINITIONS.reduce(
    (count, definition) => count + definition.sections.reduce(
      (fields, section) => fields + section.fields.length,
      0,
    ),
    0,
  );
  const fingerprint = createHash('sha256')
    .update(canonicalJson(FORM_DEFINITIONS))
    .digest('hex');

  assert.equal(sectionCount, 56);
  assert.equal(fieldCount, 390);
  assert.equal(
    fingerprint,
    'df5cda7af9d65d9f6c19bdcaec182a61d248b1d9fe47bb29478f1d736e1b482a',
  );
});

test('Installation form dynamically exposes exact A3RM and A6M options', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const channels = definition.sections.filter((section) =>
    section.title.startsWith('Channel '),
  );
  const firstRating = channels[0].fields.find(
    (field) => field.key === 'channel.1.rating',
  )!;
  assert.equal(channels.length, 6);
  assert.deepEqual(optionsForField(firstRating, { 'device.type': 'A3RM' }), [
    '3000A - 9cm',
    '3000A - 20cm',
    '3000A - 29cm',
  ]);
  assert.deepEqual(optionsForField(firstRating, { 'device.type': 'A6M' }), [
    '60A',
    '120A',
    '200A',
    '400A',
    '600A',
  ]);
  assert.equal(isSectionVisible(channels[2], { 'device.type': 'A3RM' }), true);
  assert.equal(isSectionVisible(channels[3], { 'device.type': 'A3RM' }), false);
  assert.equal(isSectionVisible(channels[5], { 'device.type': 'A6M' }), true);
  assert.deepEqual(SENSOR_OPTIONS_BY_DEVICE.A6M, ['60A', '120A', '200A', '400A', '600A']);
});

test('WW channel contract matches the API and portal parity signature', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const channelContract = Array.from({ length: 6 }, (_, index) => {
    const channel = index + 1;
    const section = definition.sections.find((candidate) =>
      candidate.fields.some((field) => field.key === `channel.${channel}.purpose`));
    assert.ok(section, `channel ${channel} section is declared`);
    return {
      channel,
      showWhen: section.showWhen,
      fields: section.fields.map((field) => ({
        key: field.key,
        kind: field.kind,
        required: field.required ?? false,
        ...(field.options ? { options: field.options } : {}),
        ...(field.showWhen ? { showWhen: field.showWhen } : {}),
        ...(field.optionsWhen ? { optionsWhen: field.optionsWhen } : {}),
      })),
    };
  });

  assert.equal(
    createHash('sha256').update(canonicalJson(channelContract)).digest('hex'),
    '093d63b24d8195d2ccc7cb0f434d313e226de78410bb1bcf3a2cb8d1439d46c8',
  );
});

test('changing device type clears stale dependent ratings and hidden channels', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const next = answersAfterChange(
    definition,
    {
      'device.type': 'A6M',
      'channel.1.rating': '60A',
      'channel.4.rating': '120A',
    },
    'device.type',
    'A3RM',
  );
  assert.equal(next['channel.1.rating'], undefined);
  assert.equal(next['channel.4.rating'], undefined);
});

test('a spare WW channel clears and hides load, sensor, evidence and commissioning values', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const next = answersAfterChange(
    definition,
    {
      'device.type': 'A6M',
      'channel.4.purpose': 'Sub-circuit / asset',
      'channel.4.load': 'HVAC',
      'channel.4.custom_load_type': 'Legacy custom value',
      'channel.4.rating': '120A',
      'channel.4.description': 'Warehouse air conditioning',
      'commissioning.channel_4_polarity': 'yes',
      'commissioning.channel_4_current': '18.2',
    },
    'channel.4.purpose',
    'Spare / unused',
  );
  assert.equal(next['channel.4.purpose'], 'Spare / unused');
  assert.equal(next['channel.4.load'], undefined);
  assert.equal(next['channel.4.custom_load_type'], undefined);
  assert.equal(next['channel.4.rating'], undefined);
  assert.equal(next['channel.4.description'], undefined);
  assert.equal(next['commissioning.channel_4_polarity'], undefined);
  assert.equal(next['commissioning.channel_4_current'], undefined);

  const channel = definition.sections.find((section) => section.title === 'Channel 4')!;
  const field = (key: string) => channel.fields.find((item) => item.key === key)!;
  assert.equal(isFieldVisible(field('channel.4.rating'), next), false);
  assert.equal(isFieldVisible(field('channel.4.description'), next), false);
  assert.equal(isFieldVisible(field('channel.4.nameplate_photos'), next), false);

  const submission: FormSubmission = {
    id: 'unused-a6m-channel',
    form_type: 'ww-installation',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: next,
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.equal(
    validateForm(submission).some((error) => error.startsWith('Channel 4:')),
    false,
  );
});

test('WW channel validation requires purpose first and load only for active purposes', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const channel = definition.sections.find((section) => section.title === 'Channel 1')!;
  const purpose = channel.fields.find((field) => field.key === 'channel.1.purpose')!;
  const load = channel.fields.find((field) => field.key === 'channel.1.load')!;
  assert.deepEqual(purpose.options, [
    'Main board supply',
    'Sub-circuit / asset',
    'Spare / unused',
  ]);
  assert.deepEqual(
    optionsForField(load, { 'channel.1.purpose': 'Main board supply' }),
    ['Mains Supply'],
  );
  assert.deepEqual(
    optionsForField(load, { 'channel.1.purpose': 'Sub-circuit / asset' }),
    ['HVAC', 'Lighting', 'Solar PV', 'Forklift Charger', 'Hot Water', 'General Power', 'Other'],
  );
  assert.deepEqual(
    optionsForField(load, { 'channel.1.purpose': 'Spare / unused' }),
    [],
  );
  assert.equal(isFieldVisible(load, { 'channel.1.purpose': 'Spare / unused' }), false);
  assert.equal(isFieldVisible(load, { 'channel.1.purpose': 'Sub-circuit / asset' }), true);

  const changedToMain = answersAfterChange(
    definition,
    {
      'device.type': 'A3RM',
      'channel.1.purpose': 'Sub-circuit / asset',
      'channel.1.load': 'HVAC',
      'channel.1.rating': '3000A - 9cm',
    },
    'channel.1.purpose',
    'Main board supply',
  );
  assert.equal(changedToMain['channel.1.purpose'], 'Main board supply');
  assert.equal(changedToMain['channel.1.load'], undefined);
  assert.equal(changedToMain['channel.1.rating'], undefined);

  const draft: FormSubmission = {
    id: 'purpose-validation', form_type: 'ww-installation', schema_version: 2,
    status: 'Draft', installation_id: 'installation-1', attachments: [],
    answers: {
      'device.type': 'A3RM',
      'channel.1.purpose': 'Sub-circuit / asset',
      'channel.2.purpose': 'Spare / unused',
      'channel.3.purpose': 'Spare / unused',
    },
    created_at: '2026-08-02T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
  };
  assert.ok(validateForm(draft).includes('Channel 1: Load'));
  draft.answers['channel.1.load'] = 'Mains Supply';
  assert.ok(validateForm(draft).includes('Channel 1: Load has an invalid selection'));
  draft.answers['channel.1.load'] = 'Other';
  draft.answers['channel.1.rating'] = '3000A - 9cm';
  assert.ok(validateForm(draft).includes('Channel 1: Custom load type'));
  draft.answers['channel.1.custom_load_type'] = 'Refrigeration';
  assert.equal(validateForm(draft).some((error) => error.startsWith('Channel 1:')), false);
  draft.answers = answersAfterChange(
    definition,
    draft.answers,
    'channel.1.purpose',
    'Spare / unused',
  );
  assert.equal(validateForm(draft).some((error) => error.startsWith('Channel 1:')), false);
});

test('Comms replacement-only commissioning values are hidden and cleared when no replacement occurs', () => {
  const definition = FORM_DEFINITION_BY_TYPE['comms-fault'];
  const next = answersAfterChange(
    definition,
    {
      'works.replace_device': 'yes',
      'works.new_device_type': 'A3RM',
      'works.new_device_number': 'NEW-NUMBER',
      'works.new_device_id': 'NEW-ID',
      'works.new_sensor_rating': '3000A - 9cm',
      'commissioning.onboarding_complete': 'yes',
      'commissioning.details_same': 'yes',
      'commissioning.start_screenshot': 'legacy-answer-reference',
      'commissioning.energy_screenshot': 'legacy-answer-reference',
    },
    'works.replace_device',
    'no',
  );
  for (const key of [
    'works.new_device_type',
    'works.new_device_number',
    'works.new_device_id',
    'works.new_sensor_rating',
    'commissioning.onboarding_complete',
    'commissioning.details_same',
    'commissioning.start_screenshot',
    'commissioning.energy_screenshot',
  ]) {
    assert.equal(next[key], undefined, key);
  }
  const commissioning = definition.sections.find(
    (section) => section.title === 'Commissioning details',
  )!;
  for (const key of [
    'commissioning.onboarding_complete',
    'commissioning.details_same',
    'commissioning.start_screenshot',
    'commissioning.energy_screenshot',
  ]) {
    const field = commissioning.fields.find((item) => item.key === key)!;
    assert.equal(isFieldVisible(field, next), false, key);
    assert.equal(
      isFieldVisible(field, { 'works.replace_device': 'yes' }),
      true,
      key,
    );
  }
});

test('conditional fields follow their controlling answers', () => {
  const field = {
    key: 'child',
    label: 'Child',
    kind: 'text' as const,
    showWhen: { key: 'parent', equals: 'yes' },
  };
  assert.equal(isFieldVisible(field, { parent: 'no' }), false);
  assert.equal(isFieldVisible(field, { parent: 'yes' }), true);
});

test('required yes/no fields are binary unless explicitly configured otherwise', () => {
  const definition = FORM_DEFINITION_BY_TYPE['ww-installation'];
  const prestart = definition.sections
    .find((section) => section.title === 'Pre-start information')!
    .fields.find((field) => field.key === 'prestart.safe_access')!;
  assert.equal(prestart.allowNotApplicable, undefined);

  const submission: FormSubmission = {
    id: 'binary-yes-no',
    form_type: 'ww-installation',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: { 'prestart.safe_access': 'not_applicable' },
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.ok(
    validateForm(submission).some(
      (error) =>
        error === 'Pre-start information: Do you have safe access? has an invalid selection',
    ),
  );
});

test('Comms replacement rebuilds channel count and sensor representation', () => {
  const existing = {
    id: 'meter-1',
    device_name: 'A6M Auditor',
    device_type: 'A6M' as const,
    device_id: 'OLD-ID',
    device_number: 'OLD-NUMBER',
    ww_channels: Array.from({ length: 6 }, (_, index) => ({
      load_type: index < 3 ? 'Mains Supply' : 'Not Used',
      description: `Channel ${index + 1}`,
      ct_ratio: '120A',
    })),
  };
  const replacement = meterAfterCommsReplacement(existing, {
    'works.new_device_type': 'A3RM',
    'works.new_device_id': 'NEW-ID',
    'works.new_device_number': 'NEW-NUMBER',
    'works.new_sensor_rating': '3000A - 20cm',
  });
  assert.equal(replacement.device_name, 'A3RM Auditor');
  assert.equal(replacement.device_type, 'A3RM');
  assert.equal(replacement.device_id, 'NEW-ID');
  assert.equal(replacement.device_number, 'NEW-NUMBER');
  assert.equal(replacement.ww_channels?.length, 3);
  assert.equal(replacement.ww_channels?.[0]?.load_type, 'Mains Supply');
  assert.equal(replacement.ww_channels?.[0]?.rogowski_size, '3000A - 20cm');
  assert.equal(replacement.ww_channels?.[0]?.ct_ratio, undefined);

  const expanded = meterAfterCommsReplacement(replacement, {
    'works.new_device_type': 'A6M',
    'works.new_device_id': 'NEWER-ID',
    'works.new_device_number': 'NEWER-NUMBER',
    'works.new_sensor_rating': '400A',
  });
  assert.equal(expanded.ww_channels?.length, 6);
  assert.ok(expanded.ww_channels?.every((channel) => channel.ct_ratio === '400A'));
  assert.ok(expanded.ww_channels?.every((channel) => channel.rogowski_size === undefined));
});

test('each form validates when every visible required field and photo is present', () => {
  for (const definition of FORM_DEFINITIONS) {
    const answers: FormSubmission['answers'] = {};
    const attachments: FormAttachment[] = [];
    for (const section of definition.sections) {
      if (section.showWhen) {
        answers[section.showWhen.key] ??= Array.isArray(section.showWhen.equals)
          ? section.showWhen.equals[0]
          : section.showWhen.equals;
      }
      if (!isSectionVisible(section, answers)) continue;
      for (const field of section.fields) {
        if (field.showWhen) {
          answers[field.showWhen.key] ??= Array.isArray(field.showWhen.equals)
            ? field.showWhen.equals[0]
            : field.showWhen.equals;
        }
        if (!field.required) continue;
        if (field.kind === 'photo') {
          attachments.push({
            id: `photo-${field.key}`,
            slot: field.key,
            uri: 'file:///fixture.jpg',
            mime_type: 'image/jpeg',
            captured_at: '2026-07-20T00:00:00.000Z',
          });
        } else {
          answers[field.key] =
            field.kind === 'yesno'
              ? 'yes'
              : field.kind === 'number'
                ? '1'
                : field.kind === 'select'
                  ? (
                      field.optionsWhen
                        ? (
                            answers[field.optionsWhen.key] ||= Object.keys(
                              field.optionsWhen.values,
                            )[0]
                          ) && optionsForField(field, answers)[0]
                        : field.options?.[0]
                    ) ?? 'fixture'
                  : 'fixture';
        }
      }
    }
    const submission: FormSubmission = {
      id: `form-${definition.type}`,
      form_type: definition.type,
      schema_version: definition.schemaVersion,
      status: 'Draft',
      installation_id: 'installation-1',
      answers,
      attachments,
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
    };
    assert.deepEqual(validateForm(submission), [], definition.type);
  }
});

test('scanner requirements are attached to every ingestion field', () => {
  const fields = Object.fromEntries(
    FORM_DEFINITIONS.flatMap((definition) =>
      definition.sections.flatMap((section) =>
        section.fields.map((field) => [`${definition.type}:${field.key}`, field]),
      )),
  );
  for (const key of [
    'ww-installation:device.number',
    'ww-installation:device.id',
    'comms-fault:existing.device_number',
    'comms-fault:existing.device_id',
    'comms-fault:works.new_device_number',
    'comms-fault:works.new_device_id',
    'ace-switchboard:job.number',
    'ace-switchboard:install.ct_serial_a',
    'ace-switchboard:install.ct_serial_b',
    'ace-switchboard:install.ct_serial_c',
    'honeywell-q400:water.serial_number',
    'captis-logger:meter.serial_number',
    'captis-logger:logger.serial_number',
  ]) {
    assert.deepEqual(fields[key]?.scanModes, ['barcode'], key);
  }
  assert.deepEqual(fields['ace-switchboard:job.qr_link']?.scanModes, ['qr']);
  assert.deepEqual(
    fields['sums-logger:meter.serial_number']?.scanModes,
    ['barcode', 'qr'],
  );
  assert.deepEqual(
    fields['sums-logger:logger.serial_number']?.scanModes,
    ['barcode', 'qr'],
  );
});

test('SUMS has the same stored field keys as Captis', () => {
  const fieldKeys = (type: 'captis-logger' | 'sums-logger') =>
    FORM_DEFINITION_BY_TYPE[type].sections.flatMap((section) =>
      section.fields.map((field) => field.key),
    );
  assert.deepEqual(fieldKeys('sums-logger'), fieldKeys('captis-logger'));
});

test('report HTML escapes field values and retains the form title', () => {
  const submission: FormSubmission = {
    id: 'form-escape',
    form_type: 'honeywell-q400',
    schema_version: 1,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {
      'site.customer_name': '<script>alert("x")</script>',
    },
    attachments: [],
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
  };
  const html = buildFormReportHtml(submission);
  assert.match(html, /Honeywell Q400 Water Meter Installation Form/);
  assert.match(html, /Prepared by Sustainability Wise/);
  assert.match(html, /Field App Complete/);
  assert.doesNotMatch(html, /InstallHub/);
  assert.match(html, /SUSTAINABILITY/);
  assert.match(html, /#142F70/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('report HTML renders escaped photo captions and still accepts legacy image strings', () => {
  const submission: FormSubmission = {
    id: 'form-caption',
    form_type: 'honeywell-q400',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {},
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  const html = buildFormReportHtml(submission, {
    'water.lcd_photo': [{
      uri: 'data:image/jpeg;base64,captioned',
      caption: '<script>alert("caption")</script>',
    }],
    'water.completed_photo': ['data:image/jpeg;base64,legacy'],
  });

  assert.match(html, /class="photo-caption"/);
  assert.match(
    html,
    /&lt;script&gt;alert\(&quot;caption&quot;\)&lt;\/script&gt;/,
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /src="data:image\/jpeg;base64,legacy"/);
});

test('Installation PDF omits A6M-only channels for an A3RM submission', () => {
  const submission: FormSubmission = {
    id: 'form-a3rm-v2',
    form_type: 'ww-installation',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {
      'device.type': 'A3RM',
    },
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  const html = buildFormReportHtml(submission);
  assert.match(html, /Channel 3/);
  assert.doesNotMatch(html, /Channel 4/);
});

test('SUMS report uses the SUMS form identity', () => {
  const submission: FormSubmission = {
    id: 'form-sums',
    form_type: 'sums-logger',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: {},
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.match(buildFormReportHtml(submission), /SUMS Logger Installation Form/);
});

test('numeric required fields reject non-numeric values', () => {
  const submission: FormSubmission = {
    id: 'form-number',
    form_type: 'captis-logger',
    schema_version: 1,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: { 'logger.rsrp': 'not-a-number' },
    attachments: [],
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
  };
  assert.ok(validateForm(submission).some((error) => error.includes('must be a number')));
});

test('optional numeric and select values are validated when provided', () => {
  const honeywell: FormSubmission = {
    id: 'form-optional-number',
    form_type: 'honeywell-q400',
    schema_version: 2,
    status: 'Draft',
    installation_id: 'installation-1',
    answers: { 'site.latitude': 'not-a-coordinate' },
    attachments: [],
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  assert.ok(
    validateForm(honeywell).some((error) =>
      error.includes('Latitude must be a number'),
    ),
  );

  const comms: FormSubmission = {
    ...honeywell,
    id: 'form-optional-select',
    form_type: 'comms-fault',
    answers: { 'existing.signal': 'Invented signal' },
  };
  assert.ok(
    validateForm(comms).some((error) =>
      error.includes('Existing signal strength has an invalid selection'),
    ),
  );
});

test('same-type form PDFs keep distinct stable paths for pack merging', () => {
  const base: FormSubmission = {
    id: 'form-first',
    form_type: 'honeywell-q400',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {
      'site.customer_name': 'Example Site',
      'site.date_time': '2026-07-23T09:30:00.000Z',
    },
    attachments: [],
    created_at: '2026-07-23T09:30:00.000Z',
    updated_at: '2026-07-23T09:30:00.000Z',
  };
  const first = formPdfFilename(base);
  const second = formPdfFilename({ ...base, id: 'form-amendment' });
  assert.notEqual(first, second);
  assert.match(first, /form-first\.pdf$/);
  assert.match(second, /form-amendment\.pdf$/);
});
