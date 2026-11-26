package com.global.ct.frameinventory.inventoryimport;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

@Component
class S3ImportNotifications {
    private static final Pattern IMPORT_KEY = Pattern.compile(
        "uploads/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})/inventory_frame\\.csv");
    private final ObjectMapper mapper;

    S3ImportNotifications(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    List<Upload> parse(String body, String expectedBucket) {
        JsonNode message;
        try {
            message = mapper.readTree(body);
        } catch (JsonProcessingException invalid) {
            throw new InvalidNotification();
        }
        if (message == null) {
            throw new InvalidNotification();
        }
        if (message.path("Event").asText().equals("s3:TestEvent")) {
            return List.of();
        }
        var records = message.path("Records");
        if (!records.isArray()) {
            throw new InvalidNotification();
        }
        var uploads = new ArrayList<Upload>();
        for (var record : records) {
            if (!record.path("eventSource").asText().equals("aws:s3")
                    || !record.path("eventName").asText().equals("ObjectCreated:Put")) {
                continue;
            }
            var s3 = record.path("s3");
            String bucket = s3.path("bucket").path("name").asText();
            if (!expectedBucket.equals(bucket)) {
                continue;
            }
            var object = s3.path("object");
            String key;
            try {
                key = URLDecoder.decode(object.path("key").asText(), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException invalid) {
                throw new InvalidNotification();
            }
            var match = IMPORT_KEY.matcher(key);
            if (!match.matches()) {
                continue;
            }
            String version = object.path("versionId").asText("");
            if (version.isBlank() || version.strip().equals("null")) {
                throw new InvalidNotification();
            }
            try {
                uploads.add(new Upload(UUID.fromString(match.group(1)), bucket, key, version,
                    Instant.parse(record.path("eventTime").asText())));
            } catch (DateTimeParseException invalid) {
                throw new InvalidNotification();
            }
        }
        return List.copyOf(uploads);
    }

    record Upload(UUID jobId, String bucket, String key, String version, Instant uploadedAt) {}

    static final class InvalidNotification extends RuntimeException {}
}
