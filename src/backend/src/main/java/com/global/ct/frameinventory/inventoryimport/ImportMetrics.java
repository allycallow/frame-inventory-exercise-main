package com.global.ct.frameinventory.inventoryimport;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("local-import")
class ImportMetrics {
    ImportMetrics(MeterRegistry registry, ImportJobRepository jobs) {
        for (String status : new String[]{"PENDING", "RUNNING"}) {
            Gauge.builder("inventory.import.oldest.active", jobs, repository -> repository.oldestActiveSeconds(status))
                .description("Age of the oldest active import, measured from dispatch confirmation or job creation")
                .baseUnit("seconds")
                .tag("status", status)
                .register(registry);
        }
        Gauge.builder("inventory.import.dispatch.failures.last.hour", jobs, ImportJobRepository::recentDispatchFailures)
            .description("Jobs that failed dispatch in the last hour")
            .register(registry);

        for (String status : new String[]{"COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "EXPIRED"}) {
            Gauge.builder("inventory.import.jobs.finished.last.hour", jobs, repository -> repository.recentFinishedJobs(status))
                .description("DELTA import jobs that reached a terminal status in the last hour")
                .tag("status", status)
                .register(registry);
        }
        for (String outcome : new String[]{"applied", "unchanged", "rejected"}) {
            Gauge.builder("inventory.import.rows.last.hour", jobs, repository -> repository.recentRowOutcome(outcome))
                .description("Rows by outcome from DELTA imports that completed in the last hour")
                .tag("outcome", outcome)
                .register(registry);
        }
    }
}
