package com.toolhub.models;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ProductTest {
    @Test
    void testProductConstructorAndGetters() {
        Product product = new Product();
        product.setProductId("prod-123");
        product.setProductUrl("https://example.com/product");

        assertEquals("prod-123", product.getProductId());
        assertEquals("https://example.com/product", product.getProductUrl());
    }

    @Test
    void testProductUserTargetPrices() {
        Product product = new Product();
        assertNull(product.getUserTargetPrices());

        product.setUserTargetPrices(java.util.List.of());
        assertNotNull(product.getUserTargetPrices());
        assertTrue(product.getUserTargetPrices().isEmpty());
    }
}
