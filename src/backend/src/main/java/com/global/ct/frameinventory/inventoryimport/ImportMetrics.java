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
    }
}
