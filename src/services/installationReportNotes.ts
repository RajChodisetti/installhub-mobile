function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Pure helper kept separate from the Expo-backed PDF renderer for Node tests. */
export function buildCompletionNotesSummaryHtml(
  value: string | null | undefined,
): string {
  const notes = value?.trim();
  if (!notes) return '';
  const escaped = escapeHtml(notes).replace(/\r\n|\r|\n/g, '<br />');
  return `
  <section class="completion-notes">
    <h2>Technician completion notes</h2>
    <p>${escaped}</p>
  </section>`;
}
