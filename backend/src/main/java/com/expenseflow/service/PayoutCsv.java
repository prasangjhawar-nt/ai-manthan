package com.expenseflow.service;

import com.expenseflow.model.Claim;

import java.util.List;

public final class PayoutCsv {

    private PayoutCsv() {}

    public static String build(String batchRef, List<Claim> claims) {
        StringBuilder sb = new StringBuilder();
        sb.append("batch_ref,claim_number,employee_code,employee_name,account_number,ifsc,amount_inr,narration\n");
        for (Claim c : claims) {
            sb.append(batchRef).append(',')
              .append(c.getClaimNumber()).append(',')
              .append(c.getEmployee().getEmployeeCode()).append(',')
              .append(safe(c.getEmployee().getName())).append(',')
              .append(c.getEmployee().getAccountNumber()).append(',')
              .append(c.getEmployee().getIfsc()).append(',')
              .append(c.getTotalAmount().toPlainString()).append(',')
              .append(c.getClaimNumber()).append(" reimbursement")
              .append('\n');
        }
        return sb.toString();
    }

    private static String safe(String s) {
        if (s == null) return "";
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }
}
