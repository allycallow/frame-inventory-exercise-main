from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

RETRY = RetryPolicy(maximum_attempts=3)
STAGE_TIMEOUT = timedelta(minutes=3)
DATABASE_TIMEOUT = timedelta(minutes=2)
HEARTBEAT_TIMEOUT = timedelta(seconds=30)


@workflow.defn(name="CsvImportWorkflow")
class CsvImportWorkflow:
    @workflow.run
    async def run(self, job_id: str) -> None:
        try:
            for pass_number in range(3):
                generation = await workflow.execute_activity(
                    "Stage",
                    args=[job_id, pass_number],
                    result_type=str,
                    start_to_close_timeout=STAGE_TIMEOUT,
                    heartbeat_timeout=HEARTBEAT_TIMEOUT,
                    retry_policy=RETRY,
                )
                if not generation:
                    return
                finished = await workflow.execute_activity(
                    "Apply",
                    args=[job_id, generation],
                    result_type=bool,
                    start_to_close_timeout=DATABASE_TIMEOUT,
                    retry_policy=RETRY,
                )
                if finished:
                    return
        except ActivityError as failure:
            cause = failure.cause
            code = (
                cause.type
                if isinstance(cause, ApplicationError) and cause.non_retryable
                else "IMPORT_PROCESSING_FAILED"
            )
        else:
            code = "STAGING_UNAVAILABLE"

        await workflow.execute_activity(
            "Fail",
            args=[job_id, code],
            start_to_close_timeout=DATABASE_TIMEOUT,
            retry_policy=RETRY,
        )
