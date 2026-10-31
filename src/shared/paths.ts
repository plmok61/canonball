export function displayName(fileName: string): string {
  return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
}

// Phase 3 replaces this with prose-folder settings.
export function isProsePath(relPath: string): boolean {
  return relPath.startsWith('drafts/')
}
