import { startStandaloneServer } from '@apollo/server/standalone'
import { credentials, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { resolve } from 'node:path'
import type { ProtoGrpcType } from './generated/frames'
import { logger } from './logger'
import { createServer } from './server'

async function main() {
  const protoPath = resolve(__dirname, 'proto/frames.proto')
  const definition = loadSync(protoPath, { longs: String, defaults: true })
  const proto = loadPackageDefinition(definition) as unknown as ProtoGrpcType
  const endpoint =
    process.env.FRAME_GRPC_ENDPOINT ??
    process.env.FRAME_GRPC_TARGET ??
    'localhost:9090'
  const client = new proto.frameinventory.v1.FrameManagement(
    endpoint,
    credentials.createInsecure(),
  )

  try {
    const server = createServer(client)
    const { url } = await startStandaloneServer(server, {
      listen: { port: 4000 },
    })
    logger.info({ url }, 'Frame Inventory GraphQL API available')
  } catch (error) {
    client.close()
    throw error
  }
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Could not start the Frame Inventory BFF')
  process.exitCode = 1
})
