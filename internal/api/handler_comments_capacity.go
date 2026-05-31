package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
	"github.com/vpo/v42/internal/sse"
)

type commentHandlers struct {
	comments *store.CommentStore
	backlog  *store.BacklogStore
	tasks    *store.TaskStore
	events   *sse.Broker
}

// ListByBacklogItem handles GET /api/v1/projects/{project_id}/backlog/{backlog_item_id}/comments
func (h *commentHandlers) ListByBacklogItem(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
	id := chi.URLParam(r, "backlog_item_id")
	comments, err := h.comments.ListByBacklogItem(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list comments")
		return
	}
	respond(w, http.StatusOK, comments)
}

// ListByTask handles GET .../tasks/{task_id}/comments
func (h *commentHandlers) ListByTask(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) || !ensureTaskInItem(w, r, h.tasks) {
		return
	}
	id := chi.URLParam(r, "task_id")
	comments, err := h.comments.ListByTask(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "task not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list comments")
		return
	}
	respond(w, http.StatusOK, comments)
}

// CreateForBacklogItem handles POST .../backlog/{backlog_item_id}/comments
func (h *commentHandlers) CreateForBacklogItem(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) {
		return
	}
	// backlog_item_id is the sole parent; project_id from URL is routing-only, not a comment parent.
	backlogItemID := chi.URLParam(r, "backlog_item_id")
	claims := middleware.ClaimsFromContext(r.Context())
	comment, err := h.createComment(w, r, "", nil, &backlogItemID, nil, claims.UserID)
	if err != nil {
		return
	}
	h.events.Publish(sse.Event{Type: sse.EventCommentCreated, ProjectID: chi.URLParam(r, "project_id"), EntityID: backlogItemID, Actor: claims.UserID})
	respond(w, http.StatusCreated, comment)
}

// CreateForTask handles POST .../tasks/{task_id}/comments
func (h *commentHandlers) CreateForTask(w http.ResponseWriter, r *http.Request) {
	if !ensureItemInProject(w, r, h.backlog) || !ensureTaskInItem(w, r, h.tasks) {
		return
	}
	// task_id is the sole parent; project_id from URL is routing-only, not a comment parent.
	taskID := chi.URLParam(r, "task_id")
	claims := middleware.ClaimsFromContext(r.Context())
	comment, err := h.createComment(w, r, "", nil, nil, &taskID, claims.UserID)
	if err != nil {
		return
	}
	h.events.Publish(sse.Event{Type: sse.EventCommentCreated, ProjectID: chi.URLParam(r, "project_id"), EntityID: taskID, Actor: claims.UserID})
	respond(w, http.StatusCreated, comment)
}

func (h *commentHandlers) createComment(w http.ResponseWriter, r *http.Request, projectID string, epicID, backlogItemID, taskID *string, authorID string) (*store.Comment, error) {
	var req struct {
		Body     string  `json:"body"`
		ParentID *string `json:"parent_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return nil, err
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "body is required")
		return nil, errors.New("empty body")
	}
	comment, err := h.comments.Create(r.Context(), projectID, epicID, backlogItemID, taskID, req.ParentID, req.Body, authorID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "parent entity not found")
			return nil, err
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create comment")
		return nil, err
	}
	return comment, nil
}

// Update handles PATCH /api/v1/comments/{id}
func (h *commentHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Body string `json:"body"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "body is required")
		return
	}
	comment, err := h.comments.Update(r.Context(), id, req.Body)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "comment not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update comment")
		return
	}
	respond(w, http.StatusOK, comment)
}

// Delete handles DELETE /api/v1/comments/{id} (soft delete)
func (h *commentHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.comments.SoftDelete(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "comment not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete comment")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Capacity handlers ---

type capacityHandlers struct {
	capacity *store.CapacityStore
}

// PersonalRadar handles GET /api/v1/users/{id}/skill-radar
func (h *capacityHandlers) PersonalRadar(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	data, err := h.capacity.PersonalRadar(r.Context(), userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get skill radar")
		return
	}
	respond(w, http.StatusOK, data)
}

// TeamSkillMatrix handles GET /api/v1/teams/{id}/skill-matrix
func (h *capacityHandlers) TeamSkillMatrix(w http.ResponseWriter, r *http.Request) {
	teamID := chi.URLParam(r, "id")
	data, err := h.capacity.TeamSkillMatrix(r.Context(), teamID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get skill matrix")
		return
	}
	respond(w, http.StatusOK, data)
}

// ProjectSkillDemand handles GET /api/v1/projects/{project_id}/skill-demand
func (h *capacityHandlers) ProjectSkillDemand(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	data, err := h.capacity.ProjectSkillDemand(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get skill demand")
		return
	}
	respond(w, http.StatusOK, data)
}

// TandemOpportunities handles GET /api/v1/teams/{id}/tandems
func (h *capacityHandlers) TandemOpportunities(w http.ResponseWriter, r *http.Request) {
	teamID := chi.URLParam(r, "id")
	data, err := h.capacity.TandemOpportunities(r.Context(), teamID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get tandem opportunities")
		return
	}
	respond(w, http.StatusOK, data)
}

// UserLearningAppetite handles GET /api/v1/users/{id}/learning-appetite
func (h *capacityHandlers) UserLearningAppetite(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	data, err := h.capacity.LearningAppetiteForUser(r.Context(), userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get learning appetite")
		return
	}
	respond(w, http.StatusOK, data)
}

// TeamLearningAppetite handles GET /api/v1/teams/{id}/learning-appetite
func (h *capacityHandlers) TeamLearningAppetite(w http.ResponseWriter, r *http.Request) {
	teamID := chi.URLParam(r, "id")
	data, err := h.capacity.TeamLearningAppetite(r.Context(), teamID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get team learning appetite")
		return
	}
	respond(w, http.StatusOK, data)
}

// UserEngagement handles GET /api/v1/users/{id}/engagement
func (h *capacityHandlers) UserEngagement(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	data, err := h.capacity.EngagementScore(r.Context(), userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get engagement score")
		return
	}
	respond(w, http.StatusOK, data)
}

// SkillCoverage handles GET /api/v1/teams/{id}/skill-coverage?skill_id=...
func (h *capacityHandlers) SkillCoverage(w http.ResponseWriter, r *http.Request) {
	teamID := chi.URLParam(r, "id")
	skillID := r.URL.Query().Get("skill_id")
	if skillID == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "skill_id query param is required")
		return
	}
	count, err := h.capacity.SkillCoverage(r.Context(), teamID, skillID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team or skill not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get skill coverage")
		return
	}
	respond(w, http.StatusOK, map[string]int64{"coverage_count": count})
}

// MemberCapacity returns per-member capacity vs active-sprint workload for a team.
func (h *capacityHandlers) MemberCapacity(w http.ResponseWriter, r *http.Request) {
	teamID := chi.URLParam(r, "id")
	data, err := h.capacity.TeamMemberCapacity(r.Context(), teamID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "team not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get member capacity")
		return
	}
	respond(w, http.StatusOK, data)
}
