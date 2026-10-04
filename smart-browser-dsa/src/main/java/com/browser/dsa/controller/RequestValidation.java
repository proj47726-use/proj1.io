package com.browser.dsa.controller;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.regex.Pattern;

/** Small input checks shared by the controllers. Bad input gets a clear 400 error. */
final class RequestValidation {
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    static final int MAX_URL_LENGTH = 2048;
    static final int MAX_TITLE_LENGTH = 200;

    private RequestValidation() { }

    static String id(String value, String name) {
        if (value == null || !ID.matcher(value).matches()) {
            throw bad(name + " must be 1-64 letters, digits, '-' or '_'");
        }
        return value;
    }

    static String url(String value) {
        if (value == null || value.length() > MAX_URL_LENGTH) {
            throw bad("url must be at most " + MAX_URL_LENGTH + " characters");
        }
        String lower = value.toLowerCase();
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            throw bad("url must start with http:// or https://");
        }
        return value;
    }

    static String title(String value) {
        if (value == null || value.isBlank()) return "Untitled";
        return value.length() > MAX_TITLE_LENGTH ? value.substring(0, MAX_TITLE_LENGTH) : value;
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
