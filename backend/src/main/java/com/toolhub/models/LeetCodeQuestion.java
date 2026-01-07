package com.toolhub.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.time.Instant;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class LeetCodeQuestion {
    private String questionId;
    private String url;
    private String status;     
    private String userId;
    private Boolean solved;   
    private Instant createdAt;
    private Instant updatedAt;
    private List<String> tags;
    private String notes = "";

    public LeetCodeQuestion() {
    }

    public LeetCodeQuestion(String questionId, String url, String status,
                            String userId, Boolean solved, Instant createdAt,
                            Instant updatedAt, String notes) {
        this.questionId = questionId;
        this.url = url;
        this.status = status;
        this.userId = userId;
        this.solved = solved;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.notes = notes;
    }

    public String getQuestionId() {
        return questionId;
    }

    public void setQuestionId(String questionId) {
        this.questionId = questionId;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public Boolean getSolved() {
        return solved;
    }

    public void setSolved(Boolean solved) {
        this.solved = solved;
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

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    // --- Added fields for LeetCode metadata ---
    private String title;
    private String difficulty;
    private Double acRate;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDifficulty() {
        return difficulty;
    }

    public void setDifficulty(String difficulty) {
        this.difficulty = difficulty;
    }

    public Double getAcRate() {
        return acRate;
    }

    public void setAcRate(Double acRate) {
        this.acRate = acRate;
    }

}
