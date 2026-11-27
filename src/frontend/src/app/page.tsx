import type { ReactElement } from 'react'
import { FrameListActions } from './inventory-workspace'

export default function Home(): ReactElement {
  return (
    <div className="page-heading">
      <div>
        <h1>Frames</h1>
        <p className="subtle">Select a frame ID to view its details.</p>
      </div>
      <FrameListActions />
    </div>
  )
}
