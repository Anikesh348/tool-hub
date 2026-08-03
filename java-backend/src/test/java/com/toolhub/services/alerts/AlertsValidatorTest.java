package com.toolhub.services.alerts;

import static org.mockito.Mockito.*;

import com.toolhub.models.Product;
import com.toolhub.services.mongo.MongoDBClient;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AlertsValidatorTest {
  private MongoDBClient mongoDBClient;
  private Vertx vertx;
  private WebClient client;
  private AlertsValidator alertsValidator;

  @BeforeEach
  void setUp() {
    mongoDBClient = mock(MongoDBClient.class);
    vertx = mock(Vertx.class);
    client = mock(WebClient.class);
    alertsValidator = new AlertsValidator(mongoDBClient, vertx, client);
  }

  @Test
  void testCheckForAlertsAndSend_NoUsersToAlert() {
    Product product = new Product();
    product.setProductId("product-1");
    product.setUserTargetPrices(List.of());
    JsonObject productInfo = new JsonObject().put("price", "1000");
    JsonObject futureResult =
        new JsonObject()
            .put("product", JsonObject.mapFrom(product))
            .put("productInfo", productInfo);
    alertsValidator.checkForAlertsAndSend(futureResult);
  }
}
