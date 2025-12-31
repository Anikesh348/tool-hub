package com.toolhub.services.alerts;

import com.sendgrid.Method;
import com.sendgrid.Request;
import com.sendgrid.SendGrid;
import com.sendgrid.helpers.mail.Mail;
import com.sendgrid.helpers.mail.objects.Content;
import com.sendgrid.helpers.mail.objects.Email;
import io.github.cdimascio.dotenv.Dotenv;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SendgridService implements EmailAlertService {
    private final Logger log = LoggerFactory.getLogger(SendgridService.class);
    private final SendGrid sendGrid;
    Vertx vertx;
    SendgridService(Vertx vertx) {
        Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();
        String apiKey = dotenv.get("SENDGRID_API_KEY", "");
        this.sendGrid = new SendGrid(apiKey);
        this.vertx = vertx;
    }
    @Override
    public Future<Void> sendEmail(String subject, String toEmail, String body) {
        Promise<Void> promise = Promise.promise();
        String fromEmail = "anikeshthakur85@gmail.com";
        Email from = new Email(fromEmail);
        Email to = new Email(toEmail);
        Content content = new Content("text/html", body);
        Mail mail = new Mail(from, subject, to, content);
        Request request = new Request();
        try {
            request.setMethod(Method.POST);
            request.setEndpoint("mail/send");
            request.setBody(mail.build());
            vertx.executeBlocking(() -> sendGrid.api(request)).onSuccess(res -> {
                log.info("sent email: {}", res.toString());
                promise.complete();
            }).onFailure(fail -> promise.fail(fail.getMessage()));
        } catch (Exception e) {
            promise.fail(e.getMessage());
        }
       return promise.future();
    }
}
