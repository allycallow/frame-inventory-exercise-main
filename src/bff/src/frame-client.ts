import type { CreateFrameRequest } from './generated/frameinventory/v1/CreateFrameRequest'
import type { DeleteFrameRequest } from './generated/frameinventory/v1/DeleteFrameRequest'
import type { Frame__Output } from './generated/frameinventory/v1/Frame'
import type { GetFrameHistoryRequest } from './generated/frameinventory/v1/GetFrameHistoryRequest'
import type { GetFrameHistoryResponse__Output } from './generated/frameinventory/v1/GetFrameHistoryResponse'
import type { GetFrameRequest } from './generated/frameinventory/v1/GetFrameRequest'
import type { ListFramesRequest } from './generated/frameinventory/v1/ListFramesRequest'
import type { ListFramesResponse__Output } from './generated/frameinventory/v1/ListFramesResponse'
import type { UpdateFrameRequest } from './generated/frameinventory/v1/UpdateFrameRequest'
import type { Empty__Output } from './generated/google/protobuf/Empty'
import type { UnaryRpc } from './grpc-client'

export interface FrameClient {
  listFrames: UnaryRpc<ListFramesRequest, ListFramesResponse__Output>
  getFrame: UnaryRpc<GetFrameRequest, Frame__Output>
  getFrameHistory: UnaryRpc<
    GetFrameHistoryRequest,
    GetFrameHistoryResponse__Output
  >
  createFrame: UnaryRpc<CreateFrameRequest, Frame__Output>
  updateFrame: UnaryRpc<UpdateFrameRequest, Frame__Output>
  deleteFrame: UnaryRpc<DeleteFrameRequest, Empty__Output>
  close(): void
}
