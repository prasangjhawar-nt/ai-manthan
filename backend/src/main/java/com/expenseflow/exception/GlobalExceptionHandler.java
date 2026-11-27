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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.net.URI;
import java.util.List;
import java.util.Map;

@RestControllerAdvice
@org.springframework.core.annotation.Order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE)
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

    @ExceptionHandler(MissingRequestHeaderException.class)
    public ResponseEntity<ProblemDetail> onMissingHeader(MissingRequestHeaderException ex, HttpServletRequest req) {
        return build(HttpStatus.BAD_REQUEST, "Validation failed", ex.getHeaderName() + " header is required", req,
                List.of(Map.of("field", ex.getHeaderName(), "message", "is required")));
    }

    @ExceptionHandler({MethodArgumentTypeMismatchException.class, MissingServletRequestParameterException.class,
            MissingServletRequestPartException.class})
    public ResponseEntity<ProblemDetail> onBadParam(Exception ex, HttpServletRequest req) {
        String name = ex instanceof MethodArgumentTypeMismatchException m ? m.getName()
                : ex instanceof MissingServletRequestParameterException p ? p.getParameterName()
                : ((MissingServletRequestPartException) ex).getRequestPartName();
        return build(HttpStatus.BAD_REQUEST, "Validation failed", "Invalid or missing '" + name + "'", req,
                List.of(Map.of("field", name, "message", "is invalid or missing")));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ProblemDetail> onMediaType(HttpMediaTypeNotSupportedException ex, HttpServletRequest req) {
        return build(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported media type", ex.getMessage(), req, null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ProblemDetail> onMethod(HttpRequestMethodNotSupportedException ex, HttpServletRequest req) {
        return build(HttpStatus.METHOD_NOT_ALLOWED, "Method not allowed", ex.getMessage(), req, null);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ProblemDetail> onNoRoute(NoResourceFoundException ex, HttpServletRequest req) {
        return build(HttpStatus.NOT_FOUND, "Not found", "No such endpoint", req, null);
    }

    /** Concurrent edit (JPA @Version) or a stale lock - README 4.2 FR-CLM-5: stale version -> 409.
     *  The DAO base type also covers optimistic-lock failures not wrapped as ObjectOptimisticLockingFailureException. */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ProblemDetail> onStale(OptimisticLockingFailureException ex, HttpServletRequest req) {
        return build(HttpStatus.CONFLICT, "Stale version",
                "Someone else changed this record. Reload and try again.", req, null);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ProblemDetail> onIntegrity(DataIntegrityViolationException ex, HttpServletRequest req) {
        log.warn("Data integrity violation: {}", ex.getMostSpecificCause().getMessage());
        return build(HttpStatus.CONFLICT, "Conflict", "The request conflicts with existing data", req, null);
    }

    /** e.g. PageRequest.of(-1, ...) for ?page=-1 - a bad request, not a server error */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ProblemDetail> onIllegalArgument(IllegalArgumentException ex, HttpServletRequest req) {
        log.debug("Illegal argument: {}", ex.getMessage());
        return build(HttpStatus.BAD_REQUEST, "Validation failed", "Invalid request parameter", req, null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> onOther(Exception ex, HttpServletRequest req) {
        // Spring MVC's own exceptions (unknown path 404, 405, missing parameter, ...) carry their status
        if (ex instanceof org.springframework.web.ErrorResponse er) {
            HttpStatus status = HttpStatus.resolve(er.getStatusCode().value());
            if (status != null && status.is4xxClientError()) {
                return build(status, status.getReasonPhrase(),
                        er.getBody().getDetail() == null ? status.getReasonPhrase() : er.getBody().getDetail(), req, null);
            }
        }
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
