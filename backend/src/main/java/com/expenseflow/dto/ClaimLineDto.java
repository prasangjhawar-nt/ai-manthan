package com.expenseflow.dto;

import com.expenseflow.model.Category;
import com.expenseflow.model.ClaimLine;
import com.expenseflow.model.LineOutcome;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public record ClaimLineDto(
        Long id,
        int lineNo,
        Category category,
        LocalDate expenseDate,
        BigDecimal amount,
        String vendor,
        String city,
        Integer nights,
        String description,
        Long receiptId,
        LineOutcome outcome,
        List<String> flags,
        String reason
) {
    public static ClaimLineDto from(ClaimLine l) {
        return new ClaimLineDto(
                l.getId(),
                l.getLineNo(),
                l.getCategory(),
                l.getExpenseDate(),
                l.getAmount(),
                l.getVendor(),
                l.getCity(),
                l.getNights() == null ? null : (int) l.getNights(),
                l.getDescription(),
                l.getReceipt() == null ? null : l.getReceipt().getId(),
                l.getOutcome(),
                List.copyOf(l.getFlags()),
                l.getReason()
        );
    }
}
