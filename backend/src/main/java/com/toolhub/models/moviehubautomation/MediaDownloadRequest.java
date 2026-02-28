package com.toolhub.models.moviehubautomation;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.toolhub.enums.moviehubautomation.MediaRequestStatus;
import com.toolhub.enums.moviehubautomation.MediaType;

import java.time.Instant;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class MediaDownloadRequest {
    private String requestId;
    private String userId;
    private String userEmail;
    private String userName;
    private String title;
    private MediaType mediaType;
    private String qualityProfileId;
    private List<Integer> season;
    private MediaRequestStatus status;
    private Instant createdAt;
    private Instant updatedAt;
    private String approvedBy;
    private Instant approvedAt;
    private Instant notificationSentAt;
    private Instant downloadedAt;
    private Instant downloadedNotificationSentAt;

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

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public MediaType getMediaType() {
        return mediaType;
    }

    public void setMediaType(MediaType mediaType) {
        this.mediaType = mediaType;
    }

    public String getQualityProfileId() {
        return qualityProfileId;
    }

    public void setQualityProfileId(String qualityProfileId) {
        this.qualityProfileId = qualityProfileId;
    }

    public List<Integer> getSeason() {
        return season;
    }

    public void setSeason(List<Integer> season) {
        this.season = season;
    }

    public MediaRequestStatus getStatus() {
        return status;
    }

    public void setStatus(MediaRequestStatus status) {
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

    public Instant getNotificationSentAt() {
        return notificationSentAt;
    }

    public void setNotificationSentAt(Instant notificationSentAt) {
        this.notificationSentAt = notificationSentAt;
    }

    public Instant getDownloadedAt() {
        return downloadedAt;
    }

    public void setDownloadedAt(Instant downloadedAt) {
        this.downloadedAt = downloadedAt;
    }

    public Instant getDownloadedNotificationSentAt() {
        return downloadedNotificationSentAt;
    }

    public void setDownloadedNotificationSentAt(Instant downloadedNotificationSentAt) {
        this.downloadedNotificationSentAt = downloadedNotificationSentAt;
    }
}
