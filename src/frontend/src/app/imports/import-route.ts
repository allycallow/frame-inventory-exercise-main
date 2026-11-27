export function importJobHref(jobId: string): string {
  return `/imports/${encodeURIComponent(jobId)}`
}

export function isImportJobId(id: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
}

export function isOperatorToken(token: string): boolean {
  return /^[a-f0-9]{64}$/.test(token)
}
