package com.toolhub.services.jwt;

import com.auth0.jwt.JWT;
import com.auth0.jwt.JWTVerifier;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;
import io.github.cdimascio.dotenv.Dotenv;

import java.util.Date;


public class JWTProvider {
    static Dotenv dotenv = Dotenv.configure().ignoreIfMissing().load();
    static String secretKey = dotenv.get("JWT_SECRET", "");
    static Algorithm algorithm = Algorithm.HMAC256(secretKey);
    public static String generateToken(String userId, String role) {
        Date now = new Date();
        Date expiresAt = new Date(now.getTime() + 5L * 24 * 60 * 60 * 1000); // 5 days
        return JWT.create()
                .withClaim("userId", userId)
                .withClaim("role", role)
                .withExpiresAt(expiresAt).sign(algorithm);
    }
    public static DecodedJWT verifyToken(String token) {
        JWTVerifier jwtVerifier = JWT.require(algorithm).build();
        return jwtVerifier.verify(token);
    }


}
