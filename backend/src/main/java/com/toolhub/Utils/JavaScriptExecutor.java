package com.toolhub.Utils;

import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

public class JavaScriptExecutor {

    private static final Logger log = LoggerFactory.getLogger(JavaScriptExecutor.class);

    public static Future<JsonObject> scrape(Vertx vertx, String url) {
        Promise<JsonObject> promise = Promise.promise();
        JsonObject result = new JsonObject();
        vertx.executeBlocking(() -> {
            System.setProperty("webdriver.chrome.driver", "/usr/bin/chromedriver");
            ChromeOptions options = new ChromeOptions();
            options.setBinary("/usr/bin/chromium");
            options.addArguments("--headless=new");
            options.addArguments("--no-sandbox");
            options.addArguments("--disable-dev-shm-usage");
            options.addArguments("--disable-blink-features=AutomationControlled");
            options.addArguments("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
            Map<String, Object> prefs = new HashMap<>();
            options.setExperimentalOption("prefs", prefs);
            prefs.put("profile.managed_default_content_settings.images", 2);
            prefs.put("profile.default_content_setting_values.notifications", 2);
            prefs.put("profile.default_content_setting_values.stylesheets", 2);
            prefs.put("profile.managed_default_content_settings.plugins", 2);
            options.setExperimentalOption("excludeSwitches", new String[]{"enable-automation"});
            options.setExperimentalOption("useAutomationExtension", false);

            WebDriver driver = new ChromeDriver(options);

            try {
                ((JavascriptExecutor) driver).executeScript(
                        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");

                driver.get(url);
                WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));

                // Price
                try {
                    WebElement priceElem = wait.until(
                            ExpectedConditions.presenceOfElementLocated(
                                    By.cssSelector("span.a-price-whole")));
                    result.put("price", priceElem.getText().trim());
                } catch (Exception e) {
                    result.put("price", "not found");
                }

                // Title
                try {
                    WebElement titleElem = wait.until(
                            ExpectedConditions.presenceOfElementLocated(By.id("productTitle")));
                    result.put("title", titleElem.getText().trim());
                } catch (Exception e) {
                    result.put("title", "not found");
                }

            } finally {
                driver.quit();
            }
            return result;
        }).onSuccess(driverResult -> {
            promise.complete(result);
        }).onFailure(fail -> {
            log.error("failure in running scrapping script: {}", fail.getMessage());
            promise.fail(fail.getMessage());
        });
        return promise.future();
    }
}
