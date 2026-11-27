package com.expenseflow.dto;

public record LoginResponse(
        String token,
        String tokenType,
        long expiresInSeconds,
        UserDto user
) {}
