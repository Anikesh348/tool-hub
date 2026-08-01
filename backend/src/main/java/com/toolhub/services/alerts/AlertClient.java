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
    java.util.List<String> matchingTargetPrices;

    public AlertClient(User user, JsonObject productInfo, Product product, Vertx vertx, WebClient client) {
        this(user, productInfo, product, vertx, client, java.util.List.of());
    }

    public AlertClient(User user, JsonObject productInfo, Product product, Vertx vertx, WebClient client,
                       java.util.List<String> matchingTargetPrices) {
        this.user = user;
        this.productInfo = productInfo;
        this.product = product;
        this.vertx = vertx;
        this.client = client;
        this.matchingTargetPrices = matchingTargetPrices == null ? java.util.List.of() : matchingTargetPrices;
    }

    private String displayValue(String value, String fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        return value.trim();
    }

    private String escapeHtml(String value) {
        return displayValue(value, "")
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    public String createSubject() {
        String productName = displayValue(productInfo.getString("title"), "tracked product");
        String productPrice = displayValue(productInfo.getString("price"), "a lower price");
        return "Price drop: " + productName + " is now " + productPrice;
    }

    private String createTargetsTable() {
        if (matchingTargetPrices.isEmpty()) {
            return "";
        }
        StringBuilder rows = new StringBuilder();
        for (String targetPrice : matchingTargetPrices) {
            rows.append("""
                    <tr>
                      <td style="padding:6px 10px; border:1px solid #e5e7eb;">%s</td>
                    </tr>
                    """.formatted(escapeHtml(targetPrice)));
        }
        return """
                <table style="border-collapse:collapse; margin:12px 0;">
                  <thead>
                    <tr>
                      <th align="left" style="padding:6px 10px; border:1px solid #e5e7eb;">Your target</th>
                    </tr>
                  </thead>
                  <tbody>%s</tbody>
                </table>
                """.formatted(rows);
    }

    public String createBody() {
        String productPrice = displayValue(productInfo.getString("price"), "the latest tracked price");
        String productName = displayValue(productInfo.getString("title"), "Your tracked product");
        String formattedPrice = Utility.formatToINR(productPrice);
        String displayPrice = displayValue(formattedPrice, productPrice);
        String productUrl = product == null ? "" : displayValue(product.getProductUrl(), "#");
        String productId = product == null ? "" : displayValue(product.getProductId(), "");
        String imageUrl = displayValue(productInfo.getString("image"), "");
        String imageBlock = imageUrl.isBlank()
                ? ""
                : "<p><img src=\"%s\" alt=\"%s\" style=\"max-width:220px; height:auto; border:1px solid #e5e7eb;\" /></p>"
                    .formatted(escapeHtml(imageUrl), escapeHtml(productName));
        return """
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
                    <h3 style="margin-bottom: 8px;">Price drop alert</h3>
                    <p><strong>%s</strong> is now listed at <strong style="color:#047857;">%s</strong>.</p>
                    %s
                    %s
                    <p>Product ID: %s</p>
                    <p><a href="%s" target="_blank" rel="noopener noreferrer">View product</a></p>
                  </body>
                </html>
                """.formatted(
                escapeHtml(productName),
                escapeHtml(displayPrice),
                imageBlock,
                createTargetsTable(),
                escapeHtml(productId),
                escapeHtml(productUrl));
    }

    public void sendAlerts() {
        String subject = createSubject();
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
