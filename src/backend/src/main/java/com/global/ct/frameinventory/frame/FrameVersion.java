package com.global.ct.frameinventory.frame;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

record FrameVersion(
    String frameId,
    long versionId,
    Instant validFrom,
    Instant validTo,
    boolean current,
    String changeSource,
    String closedByChangeSource,
    LocalDateTime sourceCreatedAt,
    LocalDateTime sourceModifiedAt,
    FrameAttributes attributes,
    Map<String, String> externalReferences,
    List<String> linkedFrameIds
) {}
