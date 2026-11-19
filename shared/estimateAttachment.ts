export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const attachedEstimateMessage = 'Your repair estimate is attached as a PDF.'

export function validatePdf(name: string, size: number) {
  if (!name.toLowerCase().endsWith('.pdf') || /[/\\\r\n]/.test(name) || name.length > 255)
    throw new Error('Choose a PDF with a valid filename.')
  if (!size || size > MAX_PDF_BYTES) throw new Error('Choose a PDF up to 10 MB.')
}
