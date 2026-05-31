package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/api/middleware"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
	"github.com/vpo/v42/internal/sse"
)

// validMilestoneStatus mirrors the DB enum milestone_status exactly.
var validMilestoneStatus = map[string]bool{"future": true, "target": true, "closed": true}

type milestoneHandlers struct {
	milestones *store.MilestoneStore
	events     *sse.Broker
}

// attachHealth fills the derived Health field on each milestone from the latest
// end date among the stages bound to it. One pass over nodes, one over milestones.
func attachHealth(milestones []store.Milestone, nodes []store.TimelineNode) {
	today := time.Now()
	latest := make(map[string]time.Time, len(milestones))
	for _, n := range nodes {
		if n.MilestoneID == nil || n.EndDate == nil {
			continue
		}
		end, err := time.Parse("2006-01-02", *n.EndDate)
		if err != nil {
			continue
		}
		if cur, ok := latest[*n.MilestoneID]; !ok || end.After(cur) {
			latest[*n.MilestoneID] = end
		}
	}
	for i := range milestones {
		var endPtr *time.Time
		if e, ok := latest[milestones[i].ID]; ok {
			endPtr = &e
		}
		milestones[i].Health = store.ComputeHealth(milestones[i].Status, milestones[i].TargetDate, endPtr, today)
	}
}

// List handles GET /api/v1/projects/{project_id}/milestones
func (h *milestoneHandlers) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	milestones, err := h.milestones.List(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list milestones")
		return
	}
	nodes, err := h.milestones.ListTimelineNodes(r.Context(), projectID, false)
	if err == nil {
		attachHealth(milestones, nodes)
	}
	respond(w, http.StatusOK, milestones)
}

// Get handles GET /api/v1/projects/{project_id}/milestones/{id}
func (h *milestoneHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	projectID := chi.URLParam(r, "project_id")
	m, err := h.milestones.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get milestone")
		return
	}
	if m.ProjectID != projectID {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
		return
	}
	nodes, err := h.milestones.ListTimelineNodes(r.Context(), projectID, false)
	if err == nil {
		one := []store.Milestone{*m}
		attachHealth(one, nodes)
		*m = one[0]
	}
	respond(w, http.StatusOK, m)
}

// Create handles POST /api/v1/projects/{project_id}/milestones
func (h *milestoneHandlers) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	claims := middleware.ClaimsFromContext(r.Context())
	var req struct {
		Name        string  `json:"name"`
		Description *string `json:"description"`
		TargetDate  string  `json:"target_date"`
		Status      string  `json:"status"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name is required")
		return
	}
	if len(req.Name) > 200 {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 200 characters")
		return
	}
	if req.TargetDate == "" {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "target_date is required")
		return
	}
	if _, err := time.Parse("2006-01-02", req.TargetDate); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "target_date must be YYYY-MM-DD")
		return
	}
	if req.Status == "" {
		req.Status = "future"
	}
	if !validMilestoneStatus[req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	m, err := h.milestones.Create(r.Context(), projectID, req.Name, req.Description, req.TargetDate, req.Status)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create milestone")
		return
	}
	m.Health = store.ComputeHealth(m.Status, m.TargetDate, nil, time.Now())
	h.events.Publish(sse.Event{Type: sse.EventMilestoneCreated, ProjectID: projectID, EntityID: m.ID, Actor: claims.UserID})
	respond(w, http.StatusCreated, m)
}

// Update handles PATCH /api/v1/projects/{project_id}/milestones/{id}
func (h *milestoneHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		TargetDate  *string `json:"target_date"`
		Status      *string `json:"status"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	if req.Name != nil {
		*req.Name = strings.TrimSpace(*req.Name)
		if *req.Name == "" {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not be empty")
			return
		}
		if len(*req.Name) > 200 {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "name must not exceed 200 characters")
			return
		}
	}
	if req.TargetDate != nil {
		if _, err := time.Parse("2006-01-02", *req.TargetDate); err != nil {
			respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "target_date must be YYYY-MM-DD")
			return
		}
	}
	if req.Status != nil && !validMilestoneStatus[*req.Status] {
		respondErr(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid status value")
		return
	}
	// Cross-project isolation: verify milestone belongs to the URL's project.
	existing, err := h.milestones.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update milestone")
		return
	}
	if existing.ProjectID != projectID {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
		return
	}
	m, err := h.milestones.Update(r.Context(), id, req.Name, req.Description, req.TargetDate, req.Status)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update milestone")
		return
	}
	nodes, nerr := h.milestones.ListTimelineNodes(r.Context(), projectID, false)
	if nerr == nil {
		one := []store.Milestone{*m}
		attachHealth(one, nodes)
		*m = one[0]
	}
	h.events.Publish(sse.Event{Type: sse.EventMilestoneUpdated, ProjectID: m.ProjectID, EntityID: m.ID, Actor: actorID(r)})
	respond(w, http.StatusOK, m)
}

// Delete handles DELETE /api/v1/projects/{project_id}/milestones/{id}
func (h *milestoneHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	projectID := chi.URLParam(r, "project_id")
	existing, err := h.milestones.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete milestone")
		return
	}
	if existing.ProjectID != projectID {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
		return
	}
	if err := h.milestones.Delete(r.Context(), id); err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete milestone")
		return
	}
	h.events.Publish(sse.Event{Type: sse.EventMilestoneDeleted, ProjectID: projectID, EntityID: id, Actor: actorID(r)})
	w.WriteHeader(http.StatusNoContent)
}

// Timeline handles GET /api/v1/projects/{project_id}/timeline -- the Gantt feed.
func (h *milestoneHandlers) Timeline(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	showArchived := r.URL.Query().Get("archived") == "true"
	milestones, err := h.milestones.List(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load timeline")
		return
	}
	nodes, err := h.milestones.ListTimelineNodes(r.Context(), projectID, showArchived)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load timeline")
		return
	}
	attachHealth(milestones, nodes)
	respond(w, http.StatusOK, map[string]any{
		"milestones": milestones,
		"stages":     nodes,
	})
}

// Bind handles PUT /api/v1/projects/{project_id}/stages/{node_id}/milestone.
// Body {"milestone_id": "<uuid>"} binds; {"milestone_id": null} unbinds.
func (h *milestoneHandlers) Bind(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	nodeID := chi.URLParam(r, "node_id")
	var req struct {
		MilestoneID *string `json:"milestone_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "INVALID_JSON", "request body is not valid JSON")
		return
	}
	// When binding, ensure the milestone belongs to this project (isolation).
	if req.MilestoneID != nil && *req.MilestoneID != "" {
		m, err := h.milestones.GetByID(r.Context(), *req.MilestoneID)
		if err != nil || m.ProjectID != projectID {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "milestone not found")
			return
		}
	}
	if err := h.milestones.SetNodeMilestone(r.Context(), nodeID, req.MilestoneID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "stage not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to bind milestone")
		return
	}
	h.events.Publish(sse.Event{Type: sse.EventMilestoneBound, ProjectID: projectID, EntityID: nodeID, Actor: actorID(r)})
	w.WriteHeader(http.StatusNoContent)
}
