package com.toolhub.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class Product {
    private String productId;
    private String productUrl;
    private List<UserTargetPrices> userTargetPrices;

    public String getProductId() {
        return productId;
    }

    public void setProductId(String productId) {
        this.productId = productId;
    }

    public String getProductUrl() {
        return productUrl;
    }

    public void setProductUrl(String productUrl) {
        this.productUrl = productUrl;
    }

    public List<UserTargetPrices> getUserTargetPrices() {
        return userTargetPrices;
    }

    public void setUserTargetPrices(List<UserTargetPrices> userTargetPrices) {
        this.userTargetPrices = userTargetPrices;
    }
}
