package com.global.ct.frameinventory.inventoryimport;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("local-import")
class ImportJobService {
    private static final Duration DISPATCH_GRACE = Duration.ofMinutes(15);
    private final ImportJobRepository jobs;
    private final ImportUploadSigner signer;
    private final String bucket;

    ImportJobService(ImportJobRepository jobs, ImportUploadSigner signer,
                     @Value("${inventory.import.bucket:}") String bucket) {
        this.jobs = jobs;
        this.signer = signer;
        this.bucket = bucket;
    }

    CreatedJob create(String owner, boolean forceOverwrite) {
        if (bucket.isBlank()) {
            throw new ImportJobProblem(ImportJobProblem.Code.NOT_CONFIGURED);
        }
        UUID id = UUID.randomUUID();
        String key = "uploads/" + id + "/inventory_frame.csv";
        var signed = signer.sign(bucket, key);
        var headers = new LinkedHashMap<String, String>();
        signed.signedHeaders().forEach((name, values) -> {
            if (!name.equalsIgnoreCase("host")) {
                headers.put(name, String.join(",", values));
            }
        });
        var expires = signed.expiration();
        var job = jobs.create(id, owner, forceOverwrite, bucket, key, expires, expires.plus(DISPATCH_GRACE));
        return new CreatedJob(job, signed.url().toExternalForm(), Map.copyOf(headers));
    }

    ImportJobRepository.Job get(UUID id, String owner) {
        jobs.expireOwnedUpload(id, owner);
        return jobs.findOwned(id, owner).orElseThrow(() -> new ImportJobProblem(ImportJobProblem.Code.NOT_FOUND));
    }

    ErrorPage errors(UUID id, String owner, int page, int size) {
        get(id, owner);
        var rows = jobs.errors(id, (long) page * size, size + 1);
        return new ErrorPage(rows.subList(0, Math.min(size, rows.size())), rows.size() > size);
    }

    record CreatedJob(ImportJobRepository.Job job, String url, Map<String, String> headers) {}
    record ErrorPage(List<ImportJobRepository.RowError> items, boolean hasNext) {}
}
