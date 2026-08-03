package com.toolhub.services.jwt;

import static org.junit.jupiter.api.Assertions.*;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.toolhub.enums.user.Role;
import org.junit.jupiter.api.Test;

class JWTProviderTest {
  @Test
  void testGenerateTokenAndVerifyToken() {
    String userId = "test-user";
    String email = "test@example.com";
    Role role = Role.USER;
    String token = JWTProvider.generateToken(userId, role.toString(), email);
    assertNotNull(token);
    DecodedJWT jwt = JWTProvider.verifyToken(token);
    assertEquals(userId, jwt.getClaim("userId").asString());
    assertEquals(email, jwt.getClaim("email").asString());
    assertTrue(jwt.getExpiresAt().getTime() > System.currentTimeMillis());
  }
}
