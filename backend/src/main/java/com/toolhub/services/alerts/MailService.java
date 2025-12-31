package com.toolhub.services.alerts;

import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MailService implements EmailAlertService {
    private static Logger log = LoggerFactory.getLogger(MailService.class);
    WebClient client;
    String API_KEY;
    MailService(WebClient client) {
        this.client = client;
        Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();
        API_KEY = dotenv.get("MAIL_API_KEY", "");
    }
    @Override
    public Future<Void> sendEmail(String subject, String to, String body) {
        JsonObject payload = new JsonObject()
                .put("sender", new JsonObject().put("email", senderEmail))
                .put("to", new JsonArray().add(new JsonObject().put("email", to)))
                .put("subject", subject)
                .put("htmlContent", body);
        Promise<Void> promise = Promise.promise();
        client.postAbs("https://api.brevo.com/v3/smtp/email")
                .putHeader("accept", "application/json")
                .putHeader("Content-Type", "application/json")
                .putHeader("api-key", API_KEY)
                .sendJsonObject(payload)
                .onSuccess(res -> {
                    log.info("mail sent successfully to: {}, {}", to, res.bodyAsString());
                    promise.complete();
                }).onFailure(fail -> {
                    log.error("failure in sending mail {}", fail.getMessage());
                    promise.fail(fail.getMessage());
                });
        return promise.future();
    }
}
