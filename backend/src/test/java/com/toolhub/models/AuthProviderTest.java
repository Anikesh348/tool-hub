package com.toolhub.models;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.junit.jupiter.api.Assertions.*;

class AuthProviderTest {
    @Test
    void testConstructorAndGettersSetters() {
        Instant now = Instant.now();
        AuthProvider provider = new AuthProvider("user1", "google", "g123", "test@example.com", now, now, "hashed");
        assertEquals("user1", provider.getUserId());
        assertEquals("google", provider.getProvider());
        assertEquals("g123", provider.getProviderUserId());
        assertEquals("test@example.com", provider.getEmail());
        assertEquals(now, provider.getCreatedAt());
        assertEquals(now, provider.getUpdatedAt());
        assertEquals("hashed", provider.getHashedPassword());

        provider.setUserId("user2");
        provider.setProvider("base");
        provider.setProviderUserId("b456");
        provider.setEmail("other@example.com");
        Instant later = now.plusSeconds(60);
        provider.setCreatedAt(later);
        provider.setUpdatedAt(later);
        provider.setHashedPassword("newhash");

        assertEquals("user2", provider.getUserId());
        assertEquals("base", provider.getProvider());
        assertEquals("b456", provider.getProviderUserId());
        assertEquals("other@example.com", provider.getEmail());
        assertEquals(later, provider.getCreatedAt());
        assertEquals(later, provider.getUpdatedAt());
        assertEquals("newhash", provider.getHashedPassword());
    }
}

