from grpc import StatusCode, aio
from temporalio import activity
from temporalio.exceptions import ApplicationError

from frameinventory.v1 import import_worker_pb2 as messages
from frameinventory.v1.import_worker_pb2_grpc import ImportWorkerStub


class ImportActivities:
    def __init__(self, backend: ImportWorkerStub, token: str) -> None:
        self._backend = backend
        self._metadata = (("authorization", f"Bearer {token}"),)

    @activity.defn(name="Stage")
    async def stage(self, job_id: str, pass_number: int) -> str:
        request = messages.StageImportRequest(
            job_id=job_id, pass_number=pass_number, attempt=activity.info().attempt
        )
        updates = self._backend.Stage(request, metadata=self._metadata, timeout=175)
        try:
            generation = None
            async for update in updates:
                if update.HasField("rows_read"):
                    activity.heartbeat(update.rows_read)
                elif update.HasField("generation"):
                    generation = update.generation
            if generation is None:
                raise RuntimeError("Import staging ended without a result")
            return generation
        except aio.AioRpcError as error:
            if error.code() == StatusCode.INVALID_ARGUMENT:
                raise ApplicationError(
                    "CSV validation failed", type=error.details(), non_retryable=True
                ) from None
            raise
        finally:
            updates.cancel()

    @activity.defn(name="Apply")
    async def apply(self, job_id: str, generation: str) -> bool:
        result = await self._backend.Apply(
            messages.ApplyImportRequest(job_id=job_id, generation=generation),
            metadata=self._metadata,
            timeout=115,
        )
        return result.finished

    @activity.defn(name="Fail")
    async def fail(self, job_id: str, code: str) -> None:
        await self._backend.Fail(
            messages.FailImportRequest(job_id=job_id, code=code),
            metadata=self._metadata,
            timeout=115,
        )
