package com.global.ct.frameinventory.inventoryimport;

import java.net.URI;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;

@Component
@Profile("local-import")
class ImportUploadSigner implements AutoCloseable {
    private final S3Presigner presigner;

    @Autowired
    ImportUploadSigner(@Value("${inventory.import.region:us-east-1}") String region,
                       @Value("${inventory.import.signing-endpoint:}") String endpoint) {
        this(buildPresigner(region, endpoint));
    }

    ImportUploadSigner(S3Presigner presigner) {
        this.presigner = presigner;
    }

    private static S3Presigner buildPresigner(String region, String endpoint) {
        var builder = S3Presigner.builder().region(Region.of(region));
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build());
        }
        return builder.build();
    }

    PresignedPutObjectRequest sign(String bucket, String key) {
        return presigner.presignPutObject(request -> request.signatureDuration(Duration.ofMinutes(15))
            .putObjectRequest(PutObjectRequest.builder()
                .bucket(bucket).key(key).contentType("text/csv").ifNoneMatch("*").build()));
    }

    @Override
    public void close() {
        presigner.close();
    }
}
