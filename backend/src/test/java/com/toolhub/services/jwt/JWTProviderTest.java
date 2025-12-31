package com.toolhub.services.jwt;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.toolhub.enums.user.Role;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class JWTProviderTest {
    @Test
    void testGenerateTokenAndVerifyToken() {
        String userId = "test-user";
        Role role = Role.USER;
        String token = JWTProvider.generateToken(userId, role.toString());
        assertNotNull(token);
        DecodedJWT jwt = JWTProvider.verifyToken(token);
        assertEquals(userId, jwt.getClaim("userId").asString());
        assertTrue(jwt.getExpiresAt().getTime() > System.currentTimeMillis());
    }
}
