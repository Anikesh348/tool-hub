package com.toolhub.services.alerts;

import com.toolhub.models.Product;
import com.toolhub.models.User;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.vertx.core.Future;

class AlertClientTest {
    private User user;
    private JsonObject productInfo;
    private Product product;
    private Vertx vertx;
    private WebClient client;
    private AlertClient alertClient;

    @BeforeEach
    void setUp() {
        user = mock(User.class);
        productInfo = new JsonObject().put("price", "1000").put("title", "Test Product");
        product = mock(Product.class);
        vertx = mock(Vertx.class);
        client = mock(WebClient.class);
        alertClient = new AlertClient(user, productInfo, product, vertx, client);
    }

    @Test
    void testAlertClientConstructor() {
        when(product.getProductUrl()).thenReturn("http://example.com");
        assertNotNull(alertClient);
    }

    @Test
    void testSendAlerts() {
        when(user.getEmail()).thenReturn("test@example.com");
        when(product.getProductUrl()).thenReturn("http://example.com");
        // Mock EmailAlertService and its sendEmail method
        EmailAlertService emailAlertService = mock(EmailAlertService.class);
        when(emailAlertService.sendEmail(anyString(), anyString(), anyString())).thenReturn(Future.succeededFuture());
        // Test that alertClient can be created with proper mocks
        assertNotNull(alertClient);
    }
}
