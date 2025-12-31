package com.toolhub.services.batchprocessor;

import org.junit.jupiter.api.Test;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class BatchProcessorTest {
    static class DummyBatchProcessor implements BatchProcessor<String> {
        int called = 0;
        @Override
        public void handleBatch(int start, List<String> arrayList) {
            called++;
        }
    }

    @Test
    void testHandleBatch() {
        DummyBatchProcessor processor = new DummyBatchProcessor();
        processor.handleBatch(0, List.of("a", "b"));
        assertEquals(1, processor.called);
    }

    @Test
    void testLimitConstant() {
        assertEquals(2, BatchProcessor.LIMIT);
    }
}

