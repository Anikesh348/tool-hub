package com.toolhub.services.user.login;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import io.github.cdimascio.dotenv.Dotenv;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.Collections;

public class GoogleTokenValidator {
  private final GoogleIdTokenVerifier verifier;

  public GoogleTokenValidator() {
    Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();
    String googleClientId = dotenv.get("GOOGLE_CLIENT_ID", "").trim();
    if (googleClientId.isBlank()) {
      throw new IllegalStateException("GOOGLE_CLIENT_ID is required for Google login");
    }

    this.verifier =
        new GoogleIdTokenVerifier.Builder(new NetHttpTransport(), GsonFactory.getDefaultInstance())
            .setAudience(Collections.singletonList(googleClientId))
            .setIssuer("https://accounts.google.com")
            .build();
  }

  public GoogleUserClaims validate(String googleIdToken)
      throws GeneralSecurityException, IOException {
    GoogleIdToken idToken = verifier.verify(googleIdToken);
    if (idToken == null) {
      throw new IllegalArgumentException("invalid google token");
    }

    GoogleIdToken.Payload payload = idToken.getPayload();
    String email = payload.getEmail();
    boolean emailVerified = Boolean.TRUE.equals(payload.getEmailVerified());

    if (email == null || email.isBlank()) {
      throw new IllegalArgumentException("google token missing email");
    }
    if (!emailVerified) {
      throw new IllegalArgumentException("google email is not verified");
    }

    String normalizedEmail = email.trim();
    String name = payload.get("name") instanceof String ? (String) payload.get("name") : "";
    String picture =
        payload.get("picture") instanceof String ? (String) payload.get("picture") : "";
    String subject = payload.getSubject();

    return new GoogleUserClaims(
        normalizedEmail,
        name == null ? "" : name,
        picture == null ? "" : picture,
        subject == null ? "" : subject);
  }

  public record GoogleUserClaims(
      String email, String name, String profilePicture, String subject) {}
}
