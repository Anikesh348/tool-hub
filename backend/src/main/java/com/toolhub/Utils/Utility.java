package com.toolhub.Utils;

import io.vertx.core.json.Json;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;

import java.text.NumberFormat;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.toolhub.Utils.Constants.*;

public class Utility {

    public static <T> void buildResponse(RoutingContext context, Integer statusCode, T response) {
        context.response()
                .setStatusCode(statusCode)
                .putHeader(CONTENT_TYPE, CONTENT_TYPE_VALUE)
                .end(Json.encode(response));
    }

    public static <T> JsonObject createSuccessResponse(T message) {
        return new JsonObject().put("response", message);
    }
    public static <T> JsonObject createErrorResponse(T error) {
        return new JsonObject().put("error", error);
    }
    public static <T> T castToClass(JsonObject jsonObject, Class<T> clazz) {
        return jsonObject.mapTo(clazz);
    }
    public static String extractASIN(String url) {
        // Regex to extract ASIN from common Amazon URLs
        Pattern pattern = Pattern.compile("/dp/([A-Z0-9]{10})|/gp/product/([A-Z0-9]{10})");
        Matcher matcher = pattern.matcher(url);

        if (matcher.find()) {
            return matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
        }
        return null;
    }

    public static String generateProductId(String url) {
        if (url.contains("amazon.")) {
            String asin = extractASIN(url);
            if (asin == null) throw new IllegalArgumentException("Invalid Amazon URL: " + url);
            return "amazon_" + asin.toLowerCase();
        } else if (url.contains("flipkart.")) {
            String productId = extractFlipkartId(url);
            if (productId == null) throw new IllegalArgumentException("Invalid Flipkart URL: " + url);
            return "flipkart_" + productId.toLowerCase();
        } else {
            throw new IllegalArgumentException("Unsupported platform in URL: " + url);
        }
    }

    private static String extractFlipkartId(String url) {
        String pattern = "/p/(itm[0-9a-zA-Z]+)";
        Pattern regex = Pattern.compile(pattern);
        Matcher matcher = regex.matcher(url);
        return matcher.find() ? matcher.group(1) : null;
    }

    public static int extractPrice(String priceStr) {
        // Remove all non-digit characters except the decimal point
        String cleaned = priceStr.replaceAll("[^\\d.]", "");

        // Extract the integer part before the decimal point
        String[] parts = cleaned.split("\\.");
        return Integer.parseInt(parts[0]);
    }
    public static String formatToINR(String numberStr) {
        try {
            // Parse the input string to a number
            double number = Double.parseDouble(numberStr);

            // Create a NumberFormat instance for Indian locale
            NumberFormat formatter = NumberFormat.getCurrencyInstance(new Locale("en", "IN"));

            // Format the number to INR currency format
            return formatter.format(number);
        } catch (NumberFormatException e) {
            // Handle invalid input
            return "Rs." + numberStr;
        }
    }

    public static JsonObject extractRequiredUserInfo(JsonObject user) {
        JsonObject userCopy = user.copy();
        userCopy.remove("createdAt");
        userCopy.remove("updatedAt");
        userCopy.remove("_id");
        return userCopy;
    }
}
