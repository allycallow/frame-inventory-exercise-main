import { credentials, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { resolve } from 'node:path'
import type { CreateImportJobRequest } from './generated/frameinventory/v1/CreateImportJobRequest'
import type { CreateImportJobResponse__Output } from './generated/frameinventory/v1/CreateImportJobResponse'
import type { GetImportJobRequest } from './generated/frameinventory/v1/GetImportJobRequest'
import type { ImportJob__Output } from './generated/frameinventory/v1/ImportJob'
import type { ListImportRowErrorsRequest } from './generated/frameinventory/v1/ListImportRowErrorsRequest'
import type { ListImportRowErrorsResponse__Output } from './generated/frameinventory/v1/ListImportRowErrorsResponse'
import type { ProtoGrpcType } from './generated/inventory_import'
import type { UnaryRpc } from './grpc-client'

export interface InventoryImportClient {
  createImportJob: UnaryRpc<
    CreateImportJobRequest,
    CreateImportJobResponse__Output
  >
  getImportJob: UnaryRpc<GetImportJobRequest, ImportJob__Output>
  listImportRowErrors: UnaryRpc<
    ListImportRowErrorsRequest,
    ListImportRowErrorsResponse__Output
  >
  close(): void
}

export function connectInventoryImport(
  endpoint: string,
): InventoryImportClient {
  const port = /^127\.0\.0\.1:(\d{1,5})$/.exec(endpoint)?.[1]
  if (!port || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('IMPORT_GRPC_ENDPOINT must be 127.0.0.1:<port>')
  }
  const definition = loadSync(
    resolve(__dirname, 'proto/inventory_import.proto'),
    {
      longs: String,
      enums: String,
      defaults: true,
    },
  )
  const proto = loadPackageDefinition(definition) as unknown as ProtoGrpcType
  return new proto.frameinventory.v1.InventoryImport(
    endpoint,
    credentials.createInsecure(),
  )
}
