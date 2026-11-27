package com.expenseflow.dto;

public record CreateUserResponse(
        UserDto user,
        /** Plaintext password, returned ONCE on create. Not stored in the response_body
         *  of any idempotency row. HR must copy and share this out-of-band; the server
         *  will not surface it again. */
        String temporaryPassword
) {}
