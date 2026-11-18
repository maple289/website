// Log a diagnostic category/type, never source URLs, tokens, names or PDF data.
export function logPdfFailure(stage: string, cause: unknown) {
  console.error(JSON.stringify({ operation: 'pdf_preview', stage, type: cause instanceof Error ? cause.name : 'unknown' }));
}
