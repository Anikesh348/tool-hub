package com.toolhub.enums.moviehubautomation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public enum MediaType {
    SHOWS,
    MOVIES,
    UNKNOWN;

    private static final Logger log = LoggerFactory.getLogger(MediaType.class);

    static {
        try {
            log.debug("MediaType initialized with values={}", java.util.Arrays.toString(values()));
        } catch (Throwable t) {
            // ignore any logging errors during static init
        }
    }
}
