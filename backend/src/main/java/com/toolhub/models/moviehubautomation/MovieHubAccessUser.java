package com.toolhub.models.moviehubautomation;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;

@JsonIgnoreProperties(ignoreUnknown = true)
public class MovieHubAccessUser {
    private String mappingId;
    private String requestId;
    private String userId;
    private String userEmail;
    private String userName;
    private String movieHubUserName;
    private String movieHubUserNameLower;
    private String jellyfinUserId;
    private Instant createdAt;
    private Instant updatedAt;
    private String approvedBy;
    private Instant approvedAt;
    private Instant passwordResetConfirmedAt;
    private boolean active;

    public String getMappingId() {
        return mappingId;
    }

    public void setMappingId(String mappingId) {
        this.mappingId = mappingId;
    }

    public String getRequestId() {
        return requestId;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getUserEmail() {
        return userEmail;
    }

    public void setUserEmail(String userEmail) {
        this.userEmail = userEmail;
    }

    public String getUserName() {
        return userName;
    }

    public void setUserName(String userName) {
        this.userName = userName;
    }

    public String getMovieHubUserName() {
        return movieHubUserName;
    }

    public void setMovieHubUserName(String movieHubUserName) {
        this.movieHubUserName = movieHubUserName;
    }

    public String getMovieHubUserNameLower() {
        return movieHubUserNameLower;
    }

    public void setMovieHubUserNameLower(String movieHubUserNameLower) {
        this.movieHubUserNameLower = movieHubUserNameLower;
    }

    public String getJellyfinUserId() {
        return jellyfinUserId;
    }

    public void setJellyfinUserId(String jellyfinUserId) {
        this.jellyfinUserId = jellyfinUserId;
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

    public String getApprovedBy() {
        return approvedBy;
    }

    public void setApprovedBy(String approvedBy) {
        this.approvedBy = approvedBy;
    }

    public Instant getApprovedAt() {
        return approvedAt;
    }

    public void setApprovedAt(Instant approvedAt) {
        this.approvedAt = approvedAt;
    }

    public Instant getPasswordResetConfirmedAt() {
        return passwordResetConfirmedAt;
    }

    public void setPasswordResetConfirmedAt(Instant passwordResetConfirmedAt) {
        this.passwordResetConfirmedAt = passwordResetConfirmedAt;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
