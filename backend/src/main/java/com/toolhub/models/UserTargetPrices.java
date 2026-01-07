package com.toolhub.models;

import java.util.List;

public class UserTargetPrices {
    String userId;
    List<String> targetPrices;

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userIds) {
        this.userId = userIds;
    }

    public List<String> getTargetPrices() {
        return targetPrices;
    }

    public void setTargetPrices(List<String> targetPrices) {
        this.targetPrices = targetPrices;
    }
}
