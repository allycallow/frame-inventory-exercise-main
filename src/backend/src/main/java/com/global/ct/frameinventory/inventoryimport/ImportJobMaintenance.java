package com.global.ct.frameinventory.inventoryimport;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

@Configuration(proxyBeanMethods = false)
@Profile("local-import")
@EnableScheduling
class ImportJobMaintenance {
    private final ImportJobRepository jobs;

    ImportJobMaintenance(ImportJobRepository jobs) {
        this.jobs = jobs;
    }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 3_600_000)
    void cleanUp() {
        jobs.expireAwaitingUploads();
        jobs.deleteExpiredDiagnostics();
    }
}
