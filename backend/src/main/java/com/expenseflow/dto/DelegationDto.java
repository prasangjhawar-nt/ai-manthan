package com.expenseflow.dto;

import com.expenseflow.model.Delegation;

import java.time.Instant;
import java.time.LocalDate;

public record DelegationDto(
        Long id,
        Long approverId,
        String approverName,
        Long delegateId,
        String delegateName,
        LocalDate fromDate,
        LocalDate toDate,
        boolean active,
        Instant createdAt
) {
    public static DelegationDto from(Delegation d) {
        LocalDate today = LocalDate.now();
        boolean active = !today.isBefore(d.getFromDate()) && !today.isAfter(d.getToDate());
        return new DelegationDto(
                d.getId(),
                d.getApprover().getId(),
                d.getApprover().getName(),
                d.getDelegate().getId(),
                d.getDelegate().getName(),
                d.getFromDate(),
                d.getToDate(),
                active,
                d.getCreatedAt()
        );
    }
}
