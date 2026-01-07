package com.toolhub.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
@JsonIgnoreProperties(ignoreUnknown = true)
public class AuthProvider {
    private String userId;
    private String provider;
    private String providerUserId;
    private String email;
    private Instant createdAt;
    private Instant updatedAt;
    private String hashedPassword;
    public AuthProvider(String userId, String provider, String providerUserId, String email, Instant createdAt,
                        Instant updatedAt, String hashedPassword) {
        this.userId = userId;
        this.provider = provider;
        this.providerUserId = providerUserId;
        this.email = email;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.hashedPassword = hashedPassword;
    }
    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getProviderUserId() {
        return providerUserId;
    }

    public void setProviderUserId(String providerUserId) {
        this.providerUserId = providerUserId;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getHashedPassword() {
        return hashedPassword;
    }

    public void setHashedPassword(String hashedPassword) {
        this.hashedPassword = hashedPassword;
    }
}
