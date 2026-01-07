package com.toolhub.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.toolhub.enums.user.Role;

import java.time.Instant;

@JsonIgnoreProperties(ignoreUnknown = true)
public class User {
    private String userName;
    private String email;
    private String name;
    private Role role;

    public Role getRole() {
        return role;
    }

    public void setRole(Role role) {
        this.role = role;
    }

    private String userId;
    private Instant createdAt;
    private Instant updatedAt;
    private String profilePicture;

    public User() {
        // Default constructor for deserialization
    }
    public User(String userName,
                String email,
                String name, String userId, Instant createdAt, Instant updatedAt, String profilePicture) {
        this.userName = userName;
        this.email = email;
        this.name = name;
        this.userId = userId;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.profilePicture = profilePicture;
        this.role = Role.USER;

    }
    public String getUserName() {
        return userName;
    }

    public void setUserName(String userName) {
        this.userName = userName;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
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

    public String getProfilePicture() {
        return profilePicture;
    }

    public void setProfilePicture(String profilePicture) {
        this.profilePicture = profilePicture;
    }
}
