package com.global.ct.frameinventory.common;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
public class InventoryWriteLock {
    private final JdbcClient jdbc;

    public InventoryWriteLock(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    // Snapshot promotion will take this transaction lock in exclusive mode.
    public void acquireShared() {
        jdbc.sql("SELECT pg_advisory_xact_lock_shared(4, 42644)").query((row, index) -> true).single();
    }
}
