import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCompletionNotesSummaryHtml } from '../src/services/installationReportNotes';

test('installation summary escapes technician notes and preserves line breaks', () => {
  const html = buildCompletionNotesSummaryHtml(
    ' Isolated <main> & confirmed\nHandover "complete" ',
  );
  assert.match(html, /Technician completion notes/);
  assert.match(
    html,
    /Isolated &lt;main&gt; &amp; confirmed<br \/>Handover &quot;complete&quot;/,
  );
  assert.doesNotMatch(html, /<main>/);
});

test('installation summary omits missing or blank technician notes', () => {
  assert.equal(buildCompletionNotesSummaryHtml(undefined), '');
  assert.equal(buildCompletionNotesSummaryHtml(' \n '), '');
});
