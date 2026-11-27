package com.expenseflow.dto;

import jakarta.validation.constraints.Size;

public record ApproveRequest(@Size(max = 1000) String comment) {}
