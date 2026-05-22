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
)

// testHandlers serves CRUD for test specs at project / epic / backlog-item scope.
type testHandlers struct {
	tests *store.TestStore
}

type createTestRequest struct {
	Title           string  `json:"title"`
	Type            string  `json:"type"`
	Description     *string `json:"description"`
	Setup           *string `json:"setup"`
	Config          *string `json:"config"`
	Steps           *string `json:"steps"`
	ExpectedResults *string `json:"expected_results"`
}

type updateTestRequest struct {
	Title           *string `json:"title"`
	Type            *string `json:"type"`
	Description     *string `json:"description"`
	Setup           *string `json:"setup"`
	Config          *string `json:"config"`
	Steps           *string `json:"steps"`
	ExpectedResults *string `json:"expected_results"`
}

// CreateProjectTest handles POST /projects/{project_id}/tests
func (h *testHandlers) CreateProjectTest(w http.ResponseWriter, r *http.Request) {
	h.createTest(w, r, "project", "")
}

// CreateEpicTest handles POST /projects/{project_id}/epics/{epic_id}/tests
func (h *testHandlers) CreateEpicTest(w http.ResponseWriter, r *http.Request) {
	h.createTest(w, r, "epic", chi.URLParam(r, "epic_id"))
}

// CreateItemTest handles POST /projects/{project_id}/backlog/{backlog_item_id}/tests
func (h *testHandlers) CreateItemTest(w http.ResponseWriter, r *http.Request) {
	h.createTest(w, r, "item", chi.URLParam(r, "backlog_item_id"))
}

func (h *testHandlers) createTest(w http.ResponseWriter, r *http.Request, scope, parentID string) {
	projectID := chi.URLParam(r, "project_id")
	claims := middleware.ClaimsFromContext(r.Context())

	var req createTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON")
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		respondErr(w, http.StatusBadRequest, "VALIDATION_ERROR", "title is required")
		return
	}

	ts, err := h.tests.CreateTest(r.Context(), projectID, scope, parentID,
		req.Title, req.Type, claims.Subject,
		req.Description, req.Setup, req.Config, req.Steps, req.ExpectedResults)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "project or parent not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create test")
		return
	}
	respond(w, http.StatusCreated, ts)
}

// ListProjectTests handles GET /projects/{project_id}/tests
func (h *testHandlers) ListProjectTests(w http.ResponseWriter, r *http.Request) {
	h.listTests(w, r, "project", "")
}

// ListEpicTests handles GET /projects/{project_id}/epics/{epic_id}/tests
func (h *testHandlers) ListEpicTests(w http.ResponseWriter, r *http.Request) {
	h.listTests(w, r, "epic", chi.URLParam(r, "epic_id"))
}

// ListItemTests handles GET /projects/{project_id}/backlog/{backlog_item_id}/tests
func (h *testHandlers) ListItemTests(w http.ResponseWriter, r *http.Request) {
	h.listTests(w, r, "item", chi.URLParam(r, "backlog_item_id"))
}

func (h *testHandlers) listTests(w http.ResponseWriter, r *http.Request, scope, scopeID string) {
	projectID := chi.URLParam(r, "project_id")
	tests, err := h.tests.ListTests(r.Context(), projectID, scope, scopeID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list tests")
		return
	}
	respond(w, http.StatusOK, tests)
}

// GetTest handles GET /projects/{project_id}/tests/{test_id}
func (h *testHandlers) GetTest(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	testID := chi.URLParam(r, "test_id")
	ts, err := h.tests.GetTest(r.Context(), projectID, testID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "test not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to get test")
		return
	}
	respond(w, http.StatusOK, ts)
}

// UpdateTest handles PATCH /projects/{project_id}/tests/{test_id}
func (h *testHandlers) UpdateTest(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	testID := chi.URLParam(r, "test_id")

	var req updateTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON")
		return
	}
	if req.Title != nil {
		*req.Title = strings.TrimSpace(*req.Title)
		if *req.Title == "" {
			respondErr(w, http.StatusBadRequest, "VALIDATION_ERROR", "title cannot be empty")
			return
		}
	}

	ts, err := h.tests.UpdateTest(r.Context(), projectID, testID,
		req.Title, req.Description, req.Setup, req.Config, req.Steps, req.ExpectedResults, req.Type)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "test not found")
			return
		}
		if errors.Is(err, domain.ErrConflict) {
			respondErr(w, http.StatusConflict, "CONFLICT", "invalid test type")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update test")
		return
	}
	respond(w, http.StatusOK, ts)
}

// DeleteTest handles DELETE /projects/{project_id}/tests/{test_id}
func (h *testHandlers) DeleteTest(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	testID := chi.URLParam(r, "test_id")
	if err := h.tests.DeleteTest(r.Context(), projectID, testID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			respondErr(w, http.StatusNotFound, "NOT_FOUND", "test not found")
			return
		}
		respondErr(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete test")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
