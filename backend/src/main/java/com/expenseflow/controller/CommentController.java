package com.expenseflow.controller;

import com.expenseflow.dto.CommentDto;
import com.expenseflow.dto.CommentRequest;
import com.expenseflow.service.CommentService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/claims/{id}/comments")
public class CommentController {

    private final CommentService comments;

    public CommentController(CommentService comments) {
        this.comments = comments;
    }

    @GetMapping
    public List<CommentDto> list(@PathVariable Long id) {
        return comments.list(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CommentDto add(@PathVariable Long id, @Valid @RequestBody CommentRequest req) {
        return comments.add(id, req);
    }
}
