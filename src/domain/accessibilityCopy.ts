export function booleanConsequenceHint(label: string, currentValue: boolean): string {
  return `Turning this ${currentValue ? 'off' : 'on'} records ${currentValue ? 'No' : 'Yes'} for “${label}”.`;
}
