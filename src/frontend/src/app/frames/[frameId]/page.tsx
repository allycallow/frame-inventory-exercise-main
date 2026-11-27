import type { ReactElement } from 'react'
import { FrameDetail } from '../../frame-detail'
import { frameIdFromSegment } from '../../frame-route'

export default async function FramePage({
  params,
}: {
  params: Promise<{ frameId: string }>
}): Promise<ReactElement> {
  const { frameId: segment } = await params
  return <FrameDetail frameId={frameIdFromSegment(segment)} />
}
