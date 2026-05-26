package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/vpo/v42/internal/db/store"
	"github.com/vpo/v42/internal/domain"
)

type readinessHandlers struct {
	backlog *store.BacklogStore
	tests   *store.TestStore
}

// Check handles GET /api/v1/projects/{project_id}/backlog/{id}/readiness
func (h *readinessHandlers) Check(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	itemID := chi.URLParam(r, "id")

	item, err := h.backlog.GetByID(r.Context(), itemID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load backlog item")
		return
	}
	if item.ProjectID != projectID {
		respondErr(w, http.StatusNotFound, "NOT_FOUND", "backlog item not found")
		return
	}

	tests, err := h.tests.ListTests(r.Context(), projectID, "item", itemID)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load tests")
		return
	}

	result := domain.CheckReadiness(domain.ReadinessInput{
		Description: item.Description,
		AcSteps:     item.AcSteps,
		Estimate:    item.Estimate,
		Clarity:     item.Clarity,
		Status:      item.Status,
		TestCount:   len(tests),
	})

	respond(w, http.StatusOK, result)
}
