package com.toolhub.services.alerts;

import com.toolhub.Utils.Utility;
import com.toolhub.models.Product;
import com.toolhub.models.User;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AlertClient {
    private static final Logger log = LoggerFactory.getLogger(AlertClient.class);
    User user;
    JsonObject productInfo;
    Product product;
    Vertx vertx;
    WebClient client;

    public AlertClient(User user, JsonObject productInfo, Product product, Vertx vertx, WebClient client) {
        this.user = user;
        this.productInfo = productInfo;
        this.product = product;
        this.vertx = vertx;
        this.client = client;
    }

    public String createBody() {
        String productPrice = productInfo.getString("price");
        String productName = productInfo.getString("title");
        String formattedPrice = Utility.formatToINR(productPrice);
        return """
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2>📉 Price Drop Alert!</h2>
                    <p>The price of your added product:</p>
                    <p><strong>%s</strong></p>
                    <p>has dropped to: <strong style="color: green;">%s</strong>.</p>
                    <p>🔗 <a href="%s" target="_blank">Click here to view the product</a></p>
                  </body>
                </html>
                """.formatted(productName, formattedPrice, product.getProductUrl());
    }

    public void sendAlerts() {
        String subject = "Hurry!!, The price of your added product has dropped";
        String body = createBody();
        String toEmail = user.getEmail();
        log.info("email body: {}, toEmail {}", body, toEmail);
        EmailAlertService emailAlertService = createMailService(client);
        emailAlertService.sendEmail(subject, toEmail, body).onSuccess(res -> {
            log.info("mailed successfully to: {}", toEmail);
        }).onFailure(mailFailure -> {
            log.error("failure in mailing: {}", mailFailure.getMessage());
        });
    }

    // For testability: allow overriding in tests
    protected EmailAlertService createMailService(WebClient client) {
        return new MailService(client);
    }
}
