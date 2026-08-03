package com.toolhub.services.speedtest;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

import org.junit.jupiter.api.Test;

class SpeedTestServiceTest {
  @Test
  void constructsWithVertx() {
    var vertx = io.vertx.core.Vertx.vertx();
    try {
      assertDoesNotThrow(() -> new SpeedTestService(vertx));
    } finally {
      vertx.close();
    }
  }
}
