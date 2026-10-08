// Shared limits for library files and private Messenger attachments.
export const previewFormats: Record<string, [string, string, number]> = {
  pdf: ["pdf", "application/pdf", 100 * 1048576],
  jpg: ["image", "image/jpeg", 50 * 1048576], jpeg: ["image", "image/jpeg", 50 * 1048576],
  png: ["image", "image/png", 50 * 1048576], gif: ["image", "image/gif", 50 * 1048576], webp: ["image", "image/webp", 50 * 1048576],
  txt: ["text", "text/plain", 2 * 1048576], json: ["text", "text/plain", 2 * 1048576],
  xml: ["text", "text/plain", 2 * 1048576], csv: ["csv", "text/plain", 2 * 1048576],
  docx: ["office", "application/pdf", 25 * 1048576], xlsx: ["office", "application/pdf", 20 * 1048576],
  xls: ["office", "application/pdf", 20 * 1048576], pptx: ["office", "application/pdf", 25 * 1048576],
};
