package com.toolhub.models;

public class ProductStatus {

    private boolean isProductExists = false;
    private boolean isUserExists = false;
    private boolean isTargetPriceExists = false;

    public boolean isProductExists() {
        return isProductExists;
    }

    public void setProductExists(boolean productExists) {
        isProductExists = productExists;
    }

    public boolean isUserExists() {
        return isUserExists;
    }

    public void setUserExists(boolean userExists) {
        isUserExists = userExists;
    }

    public boolean isTargetPriceExists() {
        return isTargetPriceExists;
    }

    public void setTargetPriceExists(boolean targetPriceExists) {
        isTargetPriceExists = targetPriceExists;
    }
}
