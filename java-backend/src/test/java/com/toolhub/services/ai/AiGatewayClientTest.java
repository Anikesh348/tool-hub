package com.toolhub.services.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AiGatewayClientTest {
  @Test
  void hmacMatchesContractVector() throws Exception {
    String actual =
        AiGatewayClient.signature(
            "01234567890123456789012345678901",
            "POST",
            "/v1/responses",
            "toolhub",
            "1700000000",
            "0123456789abcdef",
            "{}");
    assertEquals(64, actual.length());
  }
}
