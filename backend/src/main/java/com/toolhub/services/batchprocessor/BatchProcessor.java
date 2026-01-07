package com.toolhub.services.batchprocessor;

import java.util.List;

public interface BatchProcessor <T> {
    int LIMIT = 2;
    void handleBatch(int start, List<T> arrayList);
}
