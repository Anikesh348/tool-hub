package com.toolhub.services.jwt;

import com.toolhub.services.mongo.MongoDBClient;
import com.toolhub.services.user.PasswordUtil;
import io.vertx.core.Future;
import io.vertx.core.Promise;
import io.vertx.core.json.JsonObject;

import java.time.Instant;
import java.util.Date;

public class AuthSessionService {
    private static final String AUTHPROVIDER_COLLECTION = "authprovider";

    private final MongoDBClient mongoDBClient;

    public AuthSessionService(MongoDBClient mongoDBClient) {
        this.mongoDBClient = mongoDBClient;
    }

    public Future<JsonObject> issueTokens(String userId, String role, String email) {
        String accessToken = JWTProvider.generateAccessToken(userId, role, email);
        String refreshToken = JWTProvider.generateRefreshToken(userId, role, email);

        return persistRefreshToken(userId, refreshToken).map(ignored -> new JsonObject()
                .put("token", accessToken)
                .put("accessToken", accessToken)
                .put("refreshToken", refreshToken));
    }

    public Future<Boolean> isRefreshTokenValidInStore(String userId, String refreshToken) {
        Promise<Boolean> promise = Promise.promise();

        mongoDBClient.queryRecords(new JsonObject().put("userId", userId), AUTHPROVIDER_COLLECTION)
                .onSuccess(authProviders -> {
                    if (authProviders == null || authProviders.isEmpty()) {
                        promise.complete(false);
                        return;
                    }

                    boolean hasMatch = authProviders.stream()
                            .map(record -> record.getString("refreshTokenHash", ""))
                            .filter(hash -> !hash.isBlank())
                            .anyMatch(hash -> isTokenHashMatch(refreshToken, hash));

                    promise.complete(hasMatch);
                })
                .onFailure(promise::fail);

        return promise.future();
    }

    private Future<Void> persistRefreshToken(String userId, String refreshToken) {
        Date expiresAt = JWTProvider.getRefreshTokenExpiryDate(refreshToken);
        String hashedRefreshToken = PasswordUtil.hashPassword(refreshToken);
        Instant now = Instant.now();

        JsonObject query = new JsonObject().put("userId", userId);
        JsonObject update = new JsonObject()
                .put("$set", new JsonObject()
                        .put("refreshTokenHash", hashedRefreshToken)
                        .put("refreshTokenExpiresAt", expiresAt == null ? null : expiresAt.toInstant())
                        .put("updatedAt", now));

        return mongoDBClient.updateRecord(query, update, AUTHPROVIDER_COLLECTION);
    }

    private boolean isTokenHashMatch(String token, String tokenHash) {
        try {
            return PasswordUtil.checkPassword(token, tokenHash);
        } catch (Exception ignored) {
            return false;
        }
    }
}
