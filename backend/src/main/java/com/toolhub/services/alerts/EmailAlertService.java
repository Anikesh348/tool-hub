package com.toolhub.services.alerts;

import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;

public interface EmailAlertService {
    Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();
    String senderEmail = dotenv.get("SENDER_EMAIL", "");

    Future<Void> sendEmail(String subject, String to, String body);
}
