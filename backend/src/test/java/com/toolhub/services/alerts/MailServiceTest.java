package com.toolhub.services.alerts;

import io.vertx.ext.web.client.WebClient;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MailServiceTest {
    private WebClient client;
    private MailService mailService;

    @BeforeEach
    void setUp() {
        client = mock(WebClient.class, RETURNS_DEEP_STUBS);
        mailService = new MailService(client);
    }

    @Test
    @SuppressWarnings("unchecked")
    void testSendEmailReturnsFuture() {
        // Since sendEmail uses client.postAbs, we need to mock the full chain
        when(client.postAbs(anyString())
                .putHeader(anyString(), anyString())
                .putHeader(anyString(), anyString())
                .putHeader(anyString(), anyString())
                .sendJsonObject(any(JsonObject.class)))
                .thenReturn(io.vertx.core.Future.succeededFuture(mock(io.vertx.ext.web.client.HttpResponse.class)));
        var future = mailService.sendEmail("subject", "to@example.com", "body");
        assertNotNull(future);
    }
}
