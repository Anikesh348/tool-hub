package com.toolhub.Utils;

import com.toolhub.models.Product;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.InputStreamReader;

public class PythonScriptExecutor {
    private static final Logger log = LoggerFactory.getLogger(PythonScriptExecutor.class);

    public static Future<JsonObject> fetchProductDetails(Product product) {
        Promise<JsonObject> promise = Promise.promise();
        try {
            // Command to run Python script inside scrapper container
            ProcessBuilder pb = new ProcessBuilder(
                    "docker", "exec", "scrapper", "python3", "scrapping.py", product.getProductUrl()
            );
            pb.redirectErrorStream(true);

            Process process = pb.start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));

            String line;
            String lastLine = null;
            while ((line = reader.readLine()) != null) {
                log.info("Python Output: {}", line);
                lastLine = line;
            }

            int exitCode = process.waitFor();
            if (exitCode == 0 && lastLine != null && !lastLine.trim().isEmpty()) {
                JsonObject productInfo = new JsonObject(lastLine.trim());
                if (productInfo.getString("price", "").isEmpty()
                        || productInfo.getString("title", "").isEmpty()) {
                    log.error("Failed to fetch price/title for: {}", product.getProductUrl());
                    promise.fail("failed to fetch price/title");
                } else {
                    JsonObject productObj = JsonObject.mapFrom(product);
                    promise.complete(new JsonObject()
                            .put("productInfo", productInfo)
                            .put("product", productObj));
                }
            } else {
                log.error("Script exited with code {}", exitCode);
                promise.fail("Script execution failed");
            }
        } catch (Exception e) {
            log.error("Error running Python script: {}", e.getMessage(), e);
            promise.fail(e.getMessage());
        }
        return promise.future();
    }
}
