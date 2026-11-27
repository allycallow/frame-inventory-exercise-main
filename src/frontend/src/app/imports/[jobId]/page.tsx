import { notFound } from 'next/navigation'
import type { ReactElement } from 'react'
import { ImportJob } from '../import-job'
import { isImportJobId } from '../import-route'

export default async function ImportJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}): Promise<ReactElement> {
  const { jobId } = await params
  if (!isImportJobId(jobId)) notFound()

  return <ImportJob key={jobId} jobId={jobId.toLowerCase()} />
}
