package com.toolhub.services.alerts;

import com.toolhub.Utils.Utility;
import com.toolhub.models.Product;
import com.toolhub.models.User;
import com.toolhub.models.UserTargetPrices;
import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.user.UserManagement;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

public class AlertsValidator {
    private final int MARGIN = 5;
    private static final Logger log = LoggerFactory.getLogger(AlertsValidator.class);
    MongoDBClient mongoDBClient;
    Vertx vertx;
    WebClient client;
    UserManagement userManagement;
    public AlertsValidator(MongoDBClient mongoDBClient, Vertx vertx, WebClient client) {
        this.mongoDBClient = mongoDBClient;
        this.vertx = vertx;
        this.client = client;
        this.userManagement = new UserManagement(mongoDBClient);
    }

    public void checkForAlertsAndSend(JsonObject futureResult) {
        Product product = Utility.castToClass(futureResult.getJsonObject("product"), Product.class);
        JsonObject productInfo = futureResult.getJsonObject("productInfo");
        int productPrice = Utility.extractPrice(productInfo.getString("price"));
        List<UserTargetPrices> userTargetPrices = product.getUserTargetPrices();
        Set<String> toBeAlertedUsers = new HashSet<>();
        userTargetPrices.forEach(userTargetPrice -> {
            String userId = userTargetPrice.getUserId();
            userTargetPrice.getTargetPrices().forEach(targetPriceStr -> {
                int targetPrice = Utility.extractPrice(targetPriceStr);
                if (productPrice <= targetPrice + ((MARGIN) * targetPrice / 100)) {
                   toBeAlertedUsers.add(userId);
                }
            });
        });
        if (toBeAlertedUsers.isEmpty()) {
            log.info("no one to alert for this product");
            return;
        }
        log.info("{}, users will be alerted for priceDrop of: {}", toBeAlertedUsers, product.getProductId());
        userManagement.fetchUsersFromUserIds(new ArrayList<>(toBeAlertedUsers)).onFailure(fail -> {
            log.error("error in fetching users");
        }).onSuccess(usersObj -> {
            usersObj.forEach(userObj -> {
                User user = Utility.castToClass(userObj, User.class);
                AlertClient alertClient = new AlertClient(user, productInfo, product, vertx, client);
                alertClient.sendAlerts();
            });
        });
    }

}
