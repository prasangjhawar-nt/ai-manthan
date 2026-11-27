package com.expenseflow.dto;

import com.expenseflow.model.ClaimComment;
import com.expenseflow.model.Role;

import java.time.Instant;

public record CommentDto(
        Long id,
        Long claimId,
        Long authorId,
        String authorName,
        Role authorRole,
        String body,
        Instant createdAt
) {
    public static CommentDto from(ClaimComment c) {
        return new CommentDto(
                c.getId(),
                c.getClaim().getId(),
                c.getAuthor().getId(),
                c.getAuthor().getName(),
                c.getAuthor().getRole(),
                c.getBody(),
                c.getCreatedAt()
        );
    }
}
