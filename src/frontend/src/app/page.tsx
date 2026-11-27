import type { ReactElement } from 'react'
import { FrameListActions } from './inventory-workspace'

export default function Home(): ReactElement {
  return (
    <div className="page-heading">
      <h1>Frames</h1>
      <FrameListActions />
    </div>
  )
}
