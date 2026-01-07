package com.toolhub.services.moviehubautomation.intentparser;

import com.toolhub.enums.moviehubautomation.Intent;

import java.util.regex.Pattern;

public class RegexIntentResolver {

    private static final Pattern ADD_MEDIA =
            Pattern.compile("(?i)\\b(download|add|get|grab)\\b");

    private static final Pattern CHECK_STATUS =
            Pattern.compile("(?i)\\b(status|progress|time left|eta|how much time)\\b");

    private static final Pattern LIST_DOWNLOADS =
            Pattern.compile("(?i)\\b(what.*downloading|list downloads|show downloads)\\b");

    private static final Pattern CONTROL_DOWNLOAD =
            Pattern.compile("(?i)\\b(pause|resume|cancel|stop)\\b");

    public static Intent resolve(String input) {
        if (input == null) return Intent.UNKNOWN;

        if (ADD_MEDIA.matcher(input).find()) {
            return Intent.ADD_MEDIA;
        }
        if (CHECK_STATUS.matcher(input).find()) {
            return Intent.CHECK_DOWNLOAD_STATUS;
        }
        if (LIST_DOWNLOADS.matcher(input).find()) {
            return Intent.LIST_DOWNLOADS;
        }
        if (CONTROL_DOWNLOAD.matcher(input).find()) {
            return Intent.CONTROL_DOWNLOAD;
        }
        return Intent.UNKNOWN;
    }
}
