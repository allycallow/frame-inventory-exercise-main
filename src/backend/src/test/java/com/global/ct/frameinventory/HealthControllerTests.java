package com.global.ct.frameinventory;

import java.time.Instant;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class HealthControllerTests {

    @Test
    void reportsBackendHealth() {
        var health = new HealthController().health();

        assertThat(health)
            .containsEntry("status", "UP")
            .containsEntry("service", "frame-inventory-backend")
            .hasEntrySatisfying("timestamp", timestamp ->
                assertThat(timestamp).isInstanceOfSatisfying(String.class, Instant::parse));
    }
}
