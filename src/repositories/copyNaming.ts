export function nextCopyIndex(
  copies: Array<{ copy_index?: number }>,
): number {
  return Math.max(0, ...copies.map((item) => item.copy_index ?? 0)) + 1;
}

export function copyName(sourceName: string, index: number): string {
  return `${sourceName || 'Installation'} cp${index}`;
}
