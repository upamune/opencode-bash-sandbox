export function outputPreview(value: string) {
  const max = 30_000;
  if (value.length <= max) return value;
  return `...\n\n${value.slice(-max)}`;
}
