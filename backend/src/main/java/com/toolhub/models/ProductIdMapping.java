package com.toolhub.models;

import java.util.Set;

public class ProductIdMapping {
    String productUrl;
    Set<String> targetPrices;

    public String getProductUrl() {
        return productUrl;
    }

    public void setProductUrl(String productUrl) {
        this.productUrl = productUrl;
    }

    public Set<String> getTargetPrices() {
        return targetPrices;
    }

    public void setTargetPrices(Set<String> targetPrices) {
        this.targetPrices = targetPrices;
    }
}
