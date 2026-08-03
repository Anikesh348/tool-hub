package com.toolhub.models.moviehubautomation;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.toolhub.enums.moviehubautomation.MovieHubAccessStatus;
import java.time.Instant;

@JsonIgnoreProperties(ignoreUnknown = true)
public class MovieHubAccessRequest {
  private String requestId;
  private String userId;
  private String userEmail;
  private String userName;
  private String movieHubUserName;
  private String movieHubUserNameLower;
  private String encryptedPassword;
  private MovieHubAccessStatus status;
  private Instant createdAt;
  private Instant updatedAt;
  private String approvedBy;
  private Instant approvedAt;
  private Instant credentialsSentAt;
  private String jellyfinUserId;

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

  public String getEncryptedPassword() {
    return encryptedPassword;
  }

  public void setEncryptedPassword(String encryptedPassword) {
    this.encryptedPassword = encryptedPassword;
  }

  public MovieHubAccessStatus getStatus() {
    return status;
  }

  public void setStatus(MovieHubAccessStatus status) {
    this.status = status;
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

  public Instant getCredentialsSentAt() {
    return credentialsSentAt;
  }

  public void setCredentialsSentAt(Instant credentialsSentAt) {
    this.credentialsSentAt = credentialsSentAt;
  }

  public String getJellyfinUserId() {
    return jellyfinUserId;
  }

  public void setJellyfinUserId(String jellyfinUserId) {
    this.jellyfinUserId = jellyfinUserId;
  }
}
