package com.global.ct.frameinventory.inventoryimport;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.temporal.client.WorkflowClient;
import io.temporal.worker.WorkerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import software.amazon.awssdk.services.s3.S3Client;

@Configuration(proxyBeanMethods = false)
@Profile("local-import")
@ConditionalOnProperty(name = {"inventory.import.dispatch.enabled", "inventory.import.worker.enabled"},
    havingValue = "true")
class CsvImportWorkerConfiguration {
    @Bean(initMethod = "start", destroyMethod = "shutdown")
    WorkerFactory importWorker(WorkflowClient temporal, ImportStaging staging, ImportDeltaApply delta,
                               InventoryCsvReader reader, S3Client s3, MeterRegistry registry,
                               @Value("${inventory.import.dispatch.task-queue:inventory-import}") String taskQueue) {
        var factory = WorkerFactory.newInstance(temporal);
        var worker = factory.newWorker(taskQueue);
        worker.registerWorkflowImplementationTypes(CsvImportWorkflow.Implementation.class);
        var applyDuration = Timer.builder("inventory.import.apply")
            .description("Time spent in each import apply activity attempt")
            .publishPercentileHistogram()
            .register(registry);
        worker.registerActivitiesImplementations(new CsvImportActivities(staging, delta, reader, s3, applyDuration));
        return factory;
    }
}
