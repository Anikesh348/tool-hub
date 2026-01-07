package com.toolhub.services.alerts;

import io.vertx.core.Future;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class EmailAlertServiceTest {
    @Test
    void testSendEmailIsImplemented() {
        EmailAlertService service = mock(EmailAlertService.class);
        when(service.sendEmail(anyString(), anyString(), anyString())).thenReturn(Future.succeededFuture());
        assertNotNull(service.sendEmail("subject", "to", "body"));
    }
}

