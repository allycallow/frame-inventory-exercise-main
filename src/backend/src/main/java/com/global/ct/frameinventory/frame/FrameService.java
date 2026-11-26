package com.global.ct.frameinventory.frame;

import java.time.OffsetDateTime;
import java.util.List;

import com.global.ct.frameinventory.common.InventoryWriteLock;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
class FrameService {
    private static final Logger LOGGER = LoggerFactory.getLogger(FrameService.class);

    private final FrameRepository frames;
    private final InventoryWriteLock inventoryLock;
    private final Counter framesCreated;
    private final Counter framesUpdated;
    private final Counter framesSoftDeleted;

    FrameService(FrameRepository frames, MeterRegistry registry, InventoryWriteLock inventoryLock) {
        this.frames = frames;
        this.inventoryLock = inventoryLock;
        this.framesCreated = lifecycleCounter(registry, "created");
        this.framesUpdated = lifecycleCounter(registry, "updated");
        this.framesSoftDeleted = lifecycleCounter(registry, "soft_deleted");
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    FramePage list(int page, int size) {
        var matches = frames.list((long) page * size, size + 1);
        boolean hasNext = matches.size() > size;
        LOGGER.atInfo()
            .addKeyValue("page", page)
            .addKeyValue("size", size)
            .addKeyValue("totalElements", frames::countCurrent)
            .log("frame.listed");
        return new FramePage(hasNext ? List.copyOf(matches.subList(0, size)) : matches, page, size, hasNext);
    }

    FrameVersion detail(String frameId) {
        return frames.findCurrent(frameId).orElseThrow(FrameProblem::missing);
    }

    List<FrameVersion> history(String frameId) {
        var versions = frames.history(frameId);
        if (versions.isEmpty() && !frames.exists(frameId)) {
            throw FrameProblem.missing();
        }
        return versions;
    }

    @Transactional
    FrameVersion create(String frameId, FrameAttributes attributes) {
        inventoryLock.acquireShared();
        if (!frames.reserveId(frameId)) {
            throw FrameProblem.reserved();
        }
        long versionId = frames.append(frameId, attributes, null, null, "MANUAL_CREATE");
        FrameVersion created = frames.findVersion(versionId);
        afterCommit(() -> {
            framesCreated.increment();
            LOGGER.atInfo()
                .addKeyValue("frameId", frameId)
                .addKeyValue("versionId", versionId)
                .log("frame.created");
        });
        return created;
    }

    @Transactional
    FrameVersion edit(String frameId, long expectedVersionId, FrameAttributes attributes) {
        inventoryLock.acquireShared();
        Long current = lockAndCheckVersion(frameId, expectedVersionId);
        OffsetDateTime transition = frames.close(current, null);
        long versionId = frames.append(frameId, attributes, current, transition, "MANUAL_EDIT");
        frames.copyVersionChildren(current, versionId);
        FrameVersion updated = frames.findVersion(versionId);
        afterCommit(() -> {
            framesUpdated.increment();
            LOGGER.atInfo()
                .addKeyValue("frameId", frameId)
                .addKeyValue("previousVersionId", current)
                .addKeyValue("newVersionId", versionId)
                .log("frame.updated");
        });
        return updated;
    }

    @Transactional
    void delete(String frameId, Long expectedVersionId) {
        inventoryLock.acquireShared();
        Long current = lockAndCheckVersion(frameId, expectedVersionId);
        if (current != null) {
            frames.close(current, "MANUAL_DELETE");
            afterCommit(() -> {
                framesSoftDeleted.increment();
                LOGGER.atInfo()
                    .addKeyValue("frameId", frameId)
                    .addKeyValue("closedVersionId", current)
                    .log("frame.soft_deleted");
            });
        }
    }

    private Long lockAndCheckVersion(String frameId, Long expectedVersionId) {
        if (!frames.lockFrame(frameId)) {
            throw FrameProblem.missing();
        }
        Long current = frames.currentVersionId(frameId).orElse(null);
        LOGGER.atDebug()
            .addKeyValue("frameId", frameId)
            .addKeyValue("expectedVersionId", expectedVersionId)
            .addKeyValue("currentVersionId", current)
            .log("frame.version_checked");
        if (expectedVersionId != null && !expectedVersionId.equals(current)) {
            throw FrameProblem.stale(current);
        }
        return current;
    }

    private static Counter lifecycleCounter(MeterRegistry registry, String operation) {
        return Counter.builder("frame.lifecycle.changes")
            .description("Committed frame inventory changes")
            .tag("operation", operation)
            .register(registry);
    }

    private static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        }
    }

    record FramePage(List<FrameVersion> items, int page, int size, boolean hasNext) {}
}
