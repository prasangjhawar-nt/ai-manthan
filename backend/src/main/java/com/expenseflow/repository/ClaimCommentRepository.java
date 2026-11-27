package com.expenseflow.repository;

import com.expenseflow.model.ClaimComment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ClaimCommentRepository extends JpaRepository<ClaimComment, Long> {

    @Query("""
            select c from ClaimComment c
            join fetch c.author
            where c.claim.id = :claimId
            order by c.createdAt asc
            """)
    List<ClaimComment> findByClaimIdOrderByCreatedAt(@Param("claimId") Long claimId);
}
