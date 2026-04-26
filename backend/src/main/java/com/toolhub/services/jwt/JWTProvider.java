package com.toolhub.services.jwt;

import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;
import io.github.cdimascio.dotenv.Dotenv;

import java.util.Date;


public class JWTProvider {
    private static final Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();
    private static final String secretKey = dotenv.get("JWT_SECRET", "");
    private static final String issuer = dotenv.get("JWT_ISSUER", "toolhub");
    private static final long accessTokenTtlMinutes = parseLong(dotenv.get("ACCESS_TOKEN_TTL_MINUTES"), 15L);
    private static final long refreshTokenTtlDays = parseLong(dotenv.get("REFRESH_TOKEN_TTL_DAYS"), 3L);
    private static final Algorithm algorithm = Algorithm.HMAC256(secretKey);

    private static final String CLAIM_USER_ID = "userId";
    private static final String CLAIM_ROLE = "role";
    private static final String CLAIM_EMAIL = "email";
    private static final String CLAIM_TOKEN_TYPE = "tokenType";
    private static final String TOKEN_TYPE_ACCESS = "access";
    private static final String TOKEN_TYPE_REFRESH = "refresh";

    public static String generateToken(String userId, String role) {
        return generateAccessToken(userId, role, "");
    }

    public static String generateToken(String userId, String role, String email) {
        return generateAccessToken(userId, role, email);
    }

    public static String generateAccessToken(String userId, String role, String email) {
        return createToken(userId, role, email, TOKEN_TYPE_ACCESS, accessTokenTtlMinutes * 60 * 1000);
    }

    public static String generateRefreshToken(String userId, String role, String email) {
        return createToken(userId, role, email, TOKEN_TYPE_REFRESH, refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    }

    public static DecodedJWT verifyToken(String token) {
        JWTVerifier jwtVerifier = JWT.require(algorithm)
                .withIssuer(issuer)
                .build();
        return jwtVerifier.verify(token);
    }

    public static DecodedJWT verifyAccessToken(String token) {
        return verifyTokenByType(token, TOKEN_TYPE_ACCESS);
    }

    public static DecodedJWT verifyRefreshToken(String token) {
        return verifyTokenByType(token, TOKEN_TYPE_REFRESH);
    }

    public static Date getRefreshTokenExpiryDate(String refreshToken) {
        DecodedJWT decodedJWT = verifyRefreshToken(refreshToken);
        return decodedJWT.getExpiresAt();
    }

    private static DecodedJWT verifyTokenByType(String token, String expectedTokenType) {
        JWTVerifier jwtVerifier = JWT.require(algorithm)
                .withIssuer(issuer)
                .withClaim(CLAIM_TOKEN_TYPE, expectedTokenType)
                .build();
        return jwtVerifier.verify(token);
    }

    private static String createToken(String userId,
                                      String role,
                                      String email,
                                      String tokenType,
                                      long ttlMillis) {
        Date now = new Date();
        Date expiresAt = new Date(now.getTime() + ttlMillis);

        return JWT.create()
                .withIssuer(issuer)
                .withIssuedAt(now)
                .withClaim(CLAIM_USER_ID, userId)
                .withClaim(CLAIM_ROLE, role)
                .withClaim(CLAIM_EMAIL, email == null ? "" : email)
                .withClaim(CLAIM_TOKEN_TYPE, tokenType)
                .withExpiresAt(expiresAt)
                .sign(algorithm);
    }

    private static long parseLong(String value, long defaultValue) {
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ignored) {
            return defaultValue;
        }
    }
}
