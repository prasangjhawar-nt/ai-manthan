package com.expenseflow.exception;

import com.expenseflow.filter.CorrelationIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.net.URI;
import java.util.List;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ProblemDetail> onApi(ApiException ex, HttpServletRequest req) {
        return build(ex.status(), ex.title(), ex.getMessage(), req, null);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> onValidation(MethodArgumentNotValidException ex,
                                                      HttpServletRequest req) {
        List<Map<String, String>> errors = ex.getBindingResult().getFieldErrors().stream()
                .map(this::fieldError)
                .toList();
        return build(HttpStatus.BAD_REQUEST, "Validation failed",
                "One or more fields are invalid", req, errors);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemDetail> onUnreadable(HttpMessageNotReadableException ex,
                                                      HttpServletRequest req) {
        return build(HttpStatus.BAD_REQUEST, "Malformed request",
                "Request body could not be parsed", req, null);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ProblemDetail> onTooLarge(MaxUploadSizeExceededException ex,
                                                     HttpServletRequest req) {
        return build(HttpStatus.PAYLOAD_TOO_LARGE, "Payload too large",
                "Uploaded file exceeds 5 MB", req, null);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ProblemDetail> onDenied(AccessDeniedException ex, HttpServletRequest req) {
        return build(HttpStatus.FORBIDDEN, "Forbidden",
                "You are not allowed to perform this action", req, null);
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ProblemDetail> onAuth(AuthenticationException ex, HttpServletRequest req) {
        return build(HttpStatus.UNAUTHORIZED, "Unauthorized",
                "Authentication required", req, null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> onOther(Exception ex, HttpServletRequest req) {
        log.error("Unhandled exception", ex);
        return build(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error",
                "An unexpected error occurred", req, null);
    }

    private Map<String, String> fieldError(FieldError f) {
        return Map.of(
                "field", f.getField(),
                "message", f.getDefaultMessage() == null ? "invalid" : f.getDefaultMessage());
    }

    private ResponseEntity<ProblemDetail> build(HttpStatus status, String title, String detail,
                                                HttpServletRequest req, Object errors) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        pd.setTitle(title);
        pd.setInstance(URI.create(req.getRequestURI()));
        pd.setProperty("correlationId", MDC.get(CorrelationIdFilter.MDC_KEY));
        if (errors != null) {
            pd.setProperty("errors", errors);
        }
        return ResponseEntity.status(status).body(pd);
    }
}
