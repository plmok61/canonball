export function displayName(fileName: string): string {
  return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
}
