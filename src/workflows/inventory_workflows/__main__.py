import asyncio
import logging
import os
import signal
from datetime import timedelta

from grpc import aio
from temporalio.client import Client
from temporalio.worker import Worker

from frameinventory.v1.import_worker_pb2_grpc import ImportWorkerStub

from .activities import ImportActivities
from .workflow import CsvImportWorkflow


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    token = os.environ.get("INVENTORY_IMPORT_LOCAL_TOKEN")
    if not token:
        logging.info("Inventory import worker disabled. Set INVENTORY_IMPORT_LOCAL_TOKEN to enable it.")
        await stop.wait()
        return

    client = await Client.connect(
        os.environ.get("INVENTORY_IMPORT_DISPATCH_TEMPORAL_TARGET", "127.0.0.1:7233"),
        namespace=os.environ.get("INVENTORY_IMPORT_DISPATCH_TEMPORAL_NAMESPACE", "default"),
    )
    task_queue = os.environ.get("INVENTORY_IMPORT_DISPATCH_TASK_QUEUE", "inventory-import")
    async with aio.insecure_channel("127.0.0.1:9090") as backend:
        activities = ImportActivities(ImportWorkerStub(backend), token)
        async with Worker(
            client,
            task_queue=task_queue,
            workflows=[CsvImportWorkflow],
            activities=[activities.stage, activities.apply, activities.fail],
            graceful_shutdown_timeout=timedelta(seconds=20),
        ):
            logging.info("Inventory import worker polling %s", task_queue)
            await stop.wait()


if __name__ == "__main__":
    asyncio.run(main())
