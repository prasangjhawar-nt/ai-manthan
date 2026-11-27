package com.expenseflow.controller;

import com.expenseflow.dto.BulkUserResponse;
import com.expenseflow.dto.CreateUserRequest;
import com.expenseflow.dto.CreateUserResponse;
import com.expenseflow.service.AdminUserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/users")
public class AdminUserController {

    private final AdminUserService admin;

    public AdminUserController(AdminUserService admin) {
        this.admin = admin;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CreateUserResponse create(@Valid @RequestBody CreateUserRequest req) {
        return admin.create(req);
    }

    @PostMapping(value = "/bulk", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public BulkUserResponse bulk(@RequestPart("file") MultipartFile file) {
        return admin.bulkCreate(file);
    }
}
