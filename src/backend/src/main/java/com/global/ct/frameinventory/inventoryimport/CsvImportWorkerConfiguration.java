package com.global.ct.frameinventory.inventoryimport;

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
                               InventoryCsvReader reader, S3Client s3,
                               @Value("${inventory.import.dispatch.task-queue:inventory-import}") String taskQueue) {
        var factory = WorkerFactory.newInstance(temporal);
        var worker = factory.newWorker(taskQueue);
        worker.registerWorkflowImplementationTypes(CsvImportWorkflow.Implementation.class);
        worker.registerActivitiesImplementations(new CsvImportActivities(staging, delta, reader, s3));
        return factory;
    }
}
