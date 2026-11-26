import './sentry'
import { startStandaloneServer } from '@apollo/server/standalone'
import { credentials, loadPackageDefinition } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { MeterProvider } from '@opentelemetry/sdk-metrics'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { ProtoGrpcType } from './generated/frames'
import { logger } from './logger'
import { createMetricsPlugin } from './metrics'
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

  const exporter = new PrometheusExporter({
    host: process.env.OTEL_EXPORTER_PROMETHEUS_HOST ?? '127.0.0.1',
    port: 9465,
    preventServerStart: true,
  })
  const meterProvider = new MeterProvider({ readers: [exporter] })

  try {
    const server = createServer(client)
    server.addPlugin(
      createMetricsPlugin(meterProvider.getMeter('frame-inventory-bff')),
    )
    server.addPlugin({
      async serverWillStart() {
        await exporter.startServer()
        return {
          async serverWillStop() {
            await meterProvider.shutdown()
          },
        }
      },
    })
    const { url } = await startStandaloneServer(server, {
      context: async ({ res }) => {
        const correlationId = randomUUID()
        res.setHeader('X-Correlation-Id', correlationId)
        res.setHeader('Access-Control-Expose-Headers', 'X-Correlation-Id')
        return { correlationId }
      },
      listen: { port: 4000 },
    })
    logger.info({ url }, 'Frame Inventory GraphQL API available')
  } catch (error) {
    client.close()
    await meterProvider.shutdown()
    throw error
  }
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Could not start the Frame Inventory BFF')
  process.exitCode = 1
})
