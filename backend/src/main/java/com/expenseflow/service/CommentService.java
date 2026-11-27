package com.expenseflow.service;

import com.expenseflow.dto.CommentDto;
import com.expenseflow.dto.CommentRequest;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimComment;
import com.expenseflow.model.Employee;
import com.expenseflow.repository.ClaimCommentRepository;
import com.expenseflow.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@Service
public class CommentService {

    private final ClaimCommentRepository comments;
    private final ClaimService claimService;
    private final CurrentUser current;
    private final AuditService audit;

    public CommentService(ClaimCommentRepository comments, ClaimService claimService,
                          CurrentUser current, AuditService audit) {
        this.comments = comments;
        this.claimService = claimService;
        this.current = current;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<CommentDto> list(Long claimId) {
        Employee me = current.employee();
        claimService.loadVisible(claimId, me); // 404 if not visible
        return comments.findByClaimIdOrderByCreatedAt(claimId).stream().map(CommentDto::from).toList();
    }

    @Transactional
    public CommentDto add(Long claimId, CommentRequest req) {
        Employee me = current.employee();
        Claim c = claimService.loadVisible(claimId, me);
        ClaimComment comment = new ClaimComment();
        comment.setClaim(c);
        comment.setAuthor(me);
        comment.setBody(req.body());
        ClaimComment saved = comments.save(comment);
        audit.record(AuditService.Action.COMMENT_ADDED, AuditService.EntityType.CLAIM,
                saved.getId(), claimId, me, null, c.getStatus(), c.getStatus(),
                Map.of("length", req.body().length()));
        return CommentDto.from(saved);
    }
}
