package com.global.ct.frameinventory.inventoryimport;

import java.net.URI;
import java.time.Duration;

import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowClientOptions;
import io.temporal.serviceclient.WorkflowServiceStubs;
import io.temporal.serviceclient.WorkflowServiceStubsOptions;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sqs.SqsClient;

@Configuration(proxyBeanMethods = false)
@Profile("local-import")
@ConditionalOnProperty(name = "inventory.import.dispatch.enabled", havingValue = "true")
class ImportDispatchConfiguration {
    @Bean
    S3Client importDispatchS3(@Value("${inventory.import.region:us-east-1}") String region,
                              @Value("${inventory.import.dispatch.aws-endpoint:}") String endpoint) {
        var builder = S3Client.builder().region(Region.of(region))
            .overrideConfiguration(options -> options.apiCallTimeout(Duration.ofSeconds(10)));
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint)).forcePathStyle(true);
        }
        return builder.build();
    }

    @Bean
    SqsClient importDispatchSqs(@Value("${inventory.import.region:us-east-1}") String region,
                                @Value("${inventory.import.dispatch.aws-endpoint:}") String endpoint) {
        var builder = SqsClient.builder().region(Region.of(region))
            .overrideConfiguration(options -> options.apiCallTimeout(Duration.ofSeconds(10)));
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint));
        }
        return builder.build();
    }

    @Bean(destroyMethod = "shutdown")
    WorkflowServiceStubs importTemporal(@Value("${inventory.import.dispatch.temporal-target:127.0.0.1:7233}") String target) {
        return WorkflowServiceStubs.newServiceStubs(WorkflowServiceStubsOptions.newBuilder()
            .setTarget(target).setRpcTimeout(Duration.ofSeconds(5)).build());
    }

    @Bean
    WorkflowClient importWorkflowClient(WorkflowServiceStubs temporal,
                                        @Value("${inventory.import.dispatch.temporal-namespace:default}") String namespace) {
        return WorkflowClient.newInstance(temporal, WorkflowClientOptions.newBuilder().setNamespace(namespace).build());
    }
}
