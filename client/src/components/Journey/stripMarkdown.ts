/**
 * Strip markdown formatting to get plain text for previews.
 * Handles: bold, italic, headings, links, images, blockquotes, code, lists, hr.
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')           // headings
    .replace(/!\[.*?\]\(.*?\)/g, '')        // images
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')  // links → text
    .replace(/(`{3}[\s\S]*?`{3})/g, '')     // code blocks
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/\*\*(.+?)\*\*/g, '$1')        // bold **
    .replace(/__(.+?)__/g, '$1')            // bold __
    .replace(/\*(.+?)\*/g, '$1')            // italic *
    .replace(/_(.+?)_/g, '$1')              // italic _
    .replace(/~~(.+?)~~/g, '$1')            // strikethrough
    .replace(/^>\s?/gm, '')                 // blockquotes
    .replace(/^[-*+]\s+/gm, '')             // unordered lists
    .replace(/^\d+\.\s+/gm, '')             // ordered lists
    .replace(/^---+$/gm, '')                // horizontal rules
    .replace(/\n{2,}/g, ' ')               // collapse multiple newlines
    .replace(/\n/g, ' ')                    // remaining newlines → spaces
    .trim()
}

/**
 * Markdown → texto plano conservando párrafos y saltos de línea: para el
 * Studio, cuyos cuadros de texto no interpretan markdown y mostraban los
 * asteriscos tal cual ("**nuevo**").
 */
export function markdownToPlainText(md: string | null | undefined): string | null {
  if (md == null) return null
  return md
    .replace(/(`{3}[\s\S]*?`{3})/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
